//! Pure audio shaping for dictation: downmix and resample to Whisper's 16 kHz mono, and cut
//! the stream into phrases at pauses. No I/O here, so all of it is unit tested.

pub const TARGET_RATE: u32 = 16_000;
/// 30 ms at 16 kHz. Short enough to react to a pause, long enough for a stable energy reading.
pub const FRAME: usize = 480;

/// Streaming linear resampler with a mono downmix. Linear is plenty for speech recognition;
/// Whisper's own front end discards everything above 8 kHz.
pub struct Resampler {
    channels: usize,
    step: f64,
    position: f64,
    previous: f32,
}

impl Resampler {
    pub fn new(input_rate: u32, channels: u16) -> Self {
        Self {
            channels: channels.max(1) as usize,
            step: input_rate as f64 / TARGET_RATE as f64,
            position: 0.0,
            previous: 0.0,
        }
    }

    pub fn push(&mut self, interleaved: &[f32], out: &mut Vec<f32>) {
        let frames = interleaved.len() / self.channels;
        let mono = |i: usize| -> f32 {
            let start = i * self.channels;
            interleaved[start..start + self.channels].iter().sum::<f32>() / self.channels as f32
        };
        // `position` is measured from the sample before this chunk (`previous`), so index -1
        // is the carried sample and 0..frames are the new ones.
        while self.position < frames as f64 {
            let index = self.position.floor() as isize - 1;
            let fraction = (self.position - self.position.floor()) as f32;
            let a = if index < 0 { self.previous } else { mono(index as usize) };
            let b = mono((index + 1) as usize);
            out.push(a + (b - a) * fraction);
            self.position += self.step;
        }
        if frames > 0 {
            self.previous = mono(frames - 1);
            self.position -= frames as f64;
        }
    }
}

pub fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
}

/// Energy gate with an adaptive noise floor. Whisper invents text for silence, so only audio
/// this gate calls speech is ever transcribed.
pub struct PhraseCutter {
    noise: f32,
    speaking: bool,
    voiced_run: usize,
    silent_run: usize,
    voiced_total: usize,
    preroll: Vec<f32>,
    phrase: Vec<f32>,
    pending: Vec<f32>,
}

const MIN_THRESHOLD: f32 = 0.006;
const NOISE_RATIO: f32 = 2.5;
const START_FRAMES: usize = 2; // 60 ms of voice opens a phrase
const END_FRAMES: usize = 23; // ~700 ms of quiet closes it
const PREROLL_FRAMES: usize = 7; // ~200 ms kept from before the onset
const MIN_VOICED_FRAMES: usize = 10; // ~300 ms of voice, or it was a click
const MAX_PHRASE: usize = TARGET_RATE as usize * 20; // force a cut on very long runs

impl Default for PhraseCutter {
    fn default() -> Self {
        Self {
            noise: MIN_THRESHOLD / NOISE_RATIO,
            speaking: false,
            voiced_run: 0,
            silent_run: 0,
            voiced_total: 0,
            preroll: Vec::new(),
            phrase: Vec::new(),
            pending: Vec::new(),
        }
    }
}

impl PhraseCutter {
    /// Feed 16 kHz mono samples. Returns any phrases completed by this chunk, plus the energy
    /// of the last frame for the level meter.
    pub fn push(&mut self, samples: &[f32]) -> (Vec<Vec<f32>>, Option<f32>) {
        self.pending.extend_from_slice(samples);
        let mut done = Vec::new();
        let mut level = None;
        let mut offset = 0;
        while self.pending.len() - offset >= FRAME {
            let frame = self.pending[offset..offset + FRAME].to_vec();
            offset += FRAME;
            let energy = rms(&frame);
            level = Some(energy);
            if let Some(phrase) = self.frame(&frame, energy) {
                done.push(phrase);
            }
        }
        self.pending.drain(..offset);
        (done, level)
    }

    fn frame(&mut self, frame: &[f32], energy: f32) -> Option<Vec<f32>> {
        let voiced = energy > (self.noise * NOISE_RATIO).max(MIN_THRESHOLD);
        if !voiced {
            // Track the floor only in quiet, and slowly, so a long vowel never becomes "noise".
            self.noise = self.noise * 0.95 + energy * 0.05;
        }
        if !self.speaking {
            self.preroll.extend_from_slice(frame);
            let keep = PREROLL_FRAMES * FRAME;
            if self.preroll.len() > keep {
                self.preroll.drain(..self.preroll.len() - keep);
            }
            self.voiced_run = if voiced { self.voiced_run + 1 } else { 0 };
            if self.voiced_run >= START_FRAMES {
                self.speaking = true;
                self.silent_run = 0;
                self.voiced_total = self.voiced_run;
                self.phrase = std::mem::take(&mut self.preroll);
            }
            return None;
        }
        self.phrase.extend_from_slice(frame);
        if voiced {
            self.silent_run = 0;
            self.voiced_total += 1;
        } else {
            self.silent_run += 1;
        }
        if self.silent_run >= END_FRAMES || self.phrase.len() >= MAX_PHRASE {
            return self.close();
        }
        None
    }

    fn close(&mut self) -> Option<Vec<f32>> {
        let enough = self.voiced_total >= MIN_VOICED_FRAMES;
        self.speaking = false;
        self.voiced_run = 0;
        self.silent_run = 0;
        self.voiced_total = 0;
        let phrase = std::mem::take(&mut self.phrase);
        enough.then_some(phrase)
    }

    /// End of dictation: whatever was being said counts, even without a trailing pause.
    pub fn finish(&mut self) -> Option<Vec<f32>> {
        let rest = std::mem::take(&mut self.pending);
        if self.speaking {
            self.phrase.extend_from_slice(&rest);
            return self.close();
        }
        None
    }
}

/// Whisper's stock outputs for non-speech. Dropping them is the second line of defence after
/// the gate above.
pub fn clean_transcript(text: &str) -> Option<String> {
    let trimmed = text.trim();
    // "[BLANK_AUDIO]", "(music)", "*silence*": a whole line that is a stage direction.
    let annotation = (trimmed.starts_with('[') && trimmed.ends_with(']'))
        || (trimmed.starts_with('(') && trimmed.ends_with(')'))
        || (trimmed.len() > 1 && trimmed.starts_with('*') && trimmed.ends_with('*'));
    if trimmed.is_empty() || annotation {
        return None;
    }
    Some(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(seconds: f32, amplitude: f32) -> Vec<f32> {
        let n = (TARGET_RATE as f32 * seconds) as usize;
        (0..n)
            .map(|i| (i as f32 * 440.0 * std::f32::consts::TAU / TARGET_RATE as f32).sin() * amplitude)
            .collect()
    }

    #[test]
    fn resamples_and_downmixes() {
        let mut resampler = Resampler::new(48_000, 2);
        let mut out = Vec::new();
        for _ in 0..10 {
            resampler.push(&[0.5f32; 9_600], &mut out); // 0.1 s of stereo at 48 kHz
        }
        assert!((out.len() as i64 - 16_000).abs() <= 2, "{}", out.len());
        assert!(out[100..].iter().all(|s| (s - 0.5).abs() < 1e-6));
    }

    #[test]
    fn cuts_phrases_at_pauses_and_ignores_silence() {
        let mut cutter = PhraseCutter::default();
        let mut audio = vec![0.0; TARGET_RATE as usize];
        audio.extend(tone(1.0, 0.2));
        audio.extend(vec![0.0; TARGET_RATE as usize]);
        audio.extend(tone(0.8, 0.2));
        audio.extend(vec![0.0; TARGET_RATE as usize]);
        let mut phrases = Vec::new();
        for chunk in audio.chunks(1_000) {
            phrases.extend(cutter.push(chunk).0);
        }
        assert_eq!(phrases.len(), 2);
        assert!(phrases[0].len() >= TARGET_RATE as usize);
        assert!(cutter.finish().is_none());
    }

    #[test]
    fn drops_clicks_and_flushes_unfinished_speech() {
        let mut cutter = PhraseCutter::default();
        let mut audio = tone(0.1, 0.3);
        audio.extend(vec![0.0; TARGET_RATE as usize]);
        assert!(cutter.push(&audio).0.is_empty());
        cutter.push(&tone(0.6, 0.2));
        assert!(cutter.finish().is_some());
    }

    #[test]
    fn filters_non_speech_markers() {
        assert_eq!(clean_transcript(" [BLANK_AUDIO] "), None);
        assert_eq!(clean_transcript("(music)"), None);
        assert_eq!(clean_transcript("   "), None);
        assert_eq!(clean_transcript(" Add a note "), Some("Add a note".into()));
        assert_eq!(clean_transcript("नमस्ते"), Some("नमस्ते".into()));
    }
}
