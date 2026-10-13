//! Local dictation. Audio is captured, cut into phrases and transcribed by whisper.cpp in this
//! process; only the resulting text reaches the webview. Audio is never written anywhere.

mod audio;
mod models;

use audio::{clean_transcript, PhraseCutter, Resampler};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const WINDOW: &str = "main";
/// A loaded turbo model holds several hundred MB; give it back when dictation goes quiet.
const IDLE_UNLOAD: Duration = Duration::from_secs(180);
const MAX_PROMPT_CHARS: usize = 600;

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Status {
    Unavailable { reason: String },
    NeedsModel { bytes: u64 },
    Installing { received: u64, total: u64 },
    Ready,
    Listening,
    Finishing,
    Error { message: String },
}

#[derive(Default)]
pub struct Dictation {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    model_path: Option<PathBuf>,
    model: Option<Arc<WhisperContext>>,
    last_used: Option<Instant>,
    session: Option<Session>,
    install: Option<Install>,
}

struct Session {
    stop: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
}

struct Install {
    cancel: Arc<AtomicBool>,
    received: u64,
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("models"))
        .map_err(|_| "No app data folder".into())
}

fn emit_status(app: &AppHandle, status: Status) {
    let _ = app.emit_to(WINDOW, "dictation:status", status);
}

fn language_code(language: &str) -> Option<&'static str> {
    match language {
        "en" => Some("en"),
        "hi" => Some("hi"),
        "ml" => Some("ml"),
        _ => None,
    }
}

fn clean_prompt(prompt: &str) -> String {
    let words: Vec<&str> = prompt.split(|c: char| c.is_whitespace() || c.is_control()).filter(|w| !w.is_empty()).collect();
    words.join(" ").chars().take(MAX_PROMPT_CHARS).collect()
}

/// Resolves (and on first sight verifies) the model file, caching the answer.
fn model_path(app: &AppHandle, state: &Dictation) -> Option<PathBuf> {
    if let Some(path) = state.inner.lock().unwrap().model_path.clone() {
        if path.exists() {
            return Some(path);
        }
    }
    let path = models::installed(&models_dir(app).ok()?, models::current())?;
    state.inner.lock().unwrap().model_path = Some(path.clone());
    Some(path)
}

fn compute_status(app: &AppHandle, state: &Dictation) -> Status {
    {
        let inner = state.inner.lock().unwrap();
        if let Some(session) = &inner.session {
            return if session.stop.load(Ordering::Relaxed) { Status::Finishing } else { Status::Listening };
        }
        if let Some(install) = &inner.install {
            return Status::Installing { received: install.received, total: models::current().bytes };
        }
    }
    if model_path(app, state).is_some() {
        return Status::Ready;
    }
    if models::host().is_none() {
        return Status::Unavailable { reason: "This build has no speech model host configured.".into() };
    }
    Status::NeedsModel { bytes: models::current().bytes }
}

fn load_model(state: &Dictation, path: &PathBuf) -> Result<Arc<WhisperContext>, String> {
    if let Some(model) = state.inner.lock().unwrap().model.clone() {
        return Ok(model);
    }
    let mut params = WhisperContextParameters::default();
    params.use_gpu(true);
    let path_str = path.to_str().ok_or("Invalid model path")?;
    let model = Arc::new(
        WhisperContext::new_with_params(path_str, params).map_err(|_| "Could not load the speech model")?,
    );
    let mut inner = state.inner.lock().unwrap();
    // Another thread may have won the race; keep one copy.
    Ok(inner.model.get_or_insert(model).clone())
}

#[tauri::command]
pub async fn dictation_status(app: AppHandle, state: tauri::State<'_, Dictation>) -> Result<Status, ()> {
    Ok(compute_status(&app, &state))
}

#[tauri::command]
pub async fn dictation_install(app: AppHandle, state: tauri::State<'_, Dictation>) -> Result<(), String> {
    let host = models::host().ok_or("This build has no speech model host configured.")?;
    let dir = models_dir(&app)?;
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut inner = state.inner.lock().unwrap();
        if inner.install.is_some() {
            return Ok(());
        }
        inner.install = Some(Install { cancel: cancel.clone(), received: 0 });
    }
    let total = models::current().bytes;
    emit_status(&app, Status::Installing { received: 0, total });
    std::thread::spawn(move || {
        let state = app.state::<Dictation>();
        let result = models::install(&dir, host, models::current(), &cancel, |received, total| {
            if let Some(install) = state.inner.lock().unwrap().install.as_mut() {
                install.received = received;
            }
            emit_status(&app, Status::Installing { received, total });
        });
        let mut inner = state.inner.lock().unwrap();
        inner.install = None;
        let status = match result {
            Ok(path) => {
                inner.model_path = Some(path);
                Status::Ready
            }
            Err(e) if e == "cancelled" => Status::NeedsModel { bytes: total },
            Err(message) => Status::Error { message },
        };
        drop(inner);
        emit_status(&app, status);
    });
    Ok(())
}

#[tauri::command]
pub fn dictation_cancel_install(state: tauri::State<'_, Dictation>) {
    if let Some(install) = &state.inner.lock().unwrap().install {
        install.cancel.store(true, Ordering::Relaxed);
    }
}

/// Loads the model ahead of the first word, so pressing the mic does not wait on disk.
#[tauri::command]
pub async fn dictation_prepare(app: AppHandle, state: tauri::State<'_, Dictation>) -> Result<(), ()> {
    if let Some(path) = model_path(&app, &state) {
        let _ = load_model(&state, &path);
        state.inner.lock().unwrap().last_used = Some(Instant::now());
    }
    Ok(())
}

#[tauri::command]
pub async fn dictation_start(
    app: AppHandle,
    state: tauri::State<'_, Dictation>,
    language: String,
    prompt: String,
) -> Result<(), String> {
    let language = language_code(&language).ok_or("Unsupported language")?;
    let path = model_path(&app, &state).ok_or("The speech model is not installed")?;
    let prompt = clean_prompt(&prompt);
    let stop = Arc::new(AtomicBool::new(false));
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut inner = state.inner.lock().unwrap();
        if let Some(session) = &inner.session {
            return Err(if session.stop.load(Ordering::Relaxed) {
                "Still finishing the last phrase. Try again in a moment."
            } else {
                "Already listening"
            }
            .into());
        }
        inner.session = Some(Session { stop: stop.clone(), cancel: cancel.clone() });
    }
    emit_status(&app, Status::Listening);

    let (phrases_tx, phrases_rx) = mpsc::channel::<Vec<f32>>();
    {
        let app = app.clone();
        let (stop, cancel) = (stop.clone(), cancel.clone());
        std::thread::spawn(move || {
            if let Err(message) = capture(&app, &stop, &cancel, phrases_tx) {
                cancel.store(true, Ordering::Relaxed);
                emit_status(&app, Status::Error { message });
            }
        });
    }
    std::thread::spawn(move || {
        let state = app.state::<Dictation>();
        let result = transcribe(&app, &state, &path, language, &prompt, &cancel, phrases_rx);
        // If transcription gave up early (say the model failed to load), the mic must not stay open.
        stop.store(true, Ordering::Relaxed);
        let mut inner = state.inner.lock().unwrap();
        inner.session = None;
        inner.last_used = Some(Instant::now());
        drop(inner);
        match result {
            Err(message) => emit_status(&app, Status::Error { message }),
            Ok(()) if !cancel.load(Ordering::Relaxed) => emit_status(&app, Status::Ready),
            Ok(()) => {}
        }
    });
    Ok(())
}

/// Stops listening; phrases already heard are still transcribed and delivered.
#[tauri::command]
pub fn dictation_stop(app: AppHandle, state: tauri::State<'_, Dictation>) {
    if let Some(session) = &state.inner.lock().unwrap().session {
        session.stop.store(true, Ordering::Relaxed);
        emit_status(&app, Status::Finishing);
    }
}

/// Stops listening and discards everything not yet delivered.
#[tauri::command]
pub fn dictation_cancel(app: AppHandle, state: tauri::State<'_, Dictation>) {
    if let Some(session) = &state.inner.lock().unwrap().session {
        session.stop.store(true, Ordering::Relaxed);
        session.cancel.store(true, Ordering::Relaxed);
        emit_status(&app, Status::Ready);
    }
}

fn capture(
    app: &AppHandle,
    stop: &AtomicBool,
    cancel: &AtomicBool,
    phrases: mpsc::Sender<Vec<f32>>,
) -> Result<(), String> {
    let device = cpal::default_host()
        .default_input_device()
        .ok_or("No microphone found")?;
    let config = device.default_input_config().map_err(|_| "Could not open the microphone")?;
    let (tx, rx) = mpsc::channel::<Vec<f32>>();
    let stream_config: cpal::StreamConfig = config.config();
    let on_error = |_| {};
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            stream_config.clone(),
            move |data: &[f32], _: &_| {
                let _ = tx.send(data.to_vec());
            },
            on_error,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            stream_config.clone(),
            move |data: &[i16], _: &_| {
                let _ = tx.send(data.iter().map(|s| *s as f32 / i16::MAX as f32).collect());
            },
            on_error,
            None,
        ),
        cpal::SampleFormat::I32 => device.build_input_stream(
            stream_config.clone(),
            move |data: &[i32], _: &_| {
                let _ = tx.send(data.iter().map(|s| *s as f32 / i32::MAX as f32).collect());
            },
            on_error,
            None,
        ),
        _ => return Err("Unsupported microphone format".into()),
    }
    .map_err(|_| "Could not open the microphone")?;
    stream.play().map_err(|_| "Could not start the microphone")?;

    let mut resampler = Resampler::new(stream_config.sample_rate, stream_config.channels);
    let mut cutter = PhraseCutter::default();
    let mut mono = Vec::new();
    let started = Instant::now();
    let mut heard_anything = false;
    let mut last_level = Instant::now();
    while !stop.load(Ordering::Relaxed) {
        let Ok(chunk) = rx.recv_timeout(Duration::from_millis(50)) else {
            continue;
        };
        heard_anything |= chunk.iter().any(|s| *s != 0.0);
        // macOS hands a denied app silence rather than an error.
        if !heard_anything && started.elapsed() > Duration::from_secs(2) {
            return Err("Microphone access is off. Allow Precipice in System Settings › Privacy & Security › Microphone.".into());
        }
        mono.clear();
        resampler.push(&chunk, &mut mono);
        let (done, level) = cutter.push(&mono);
        for phrase in done {
            let _ = phrases.send(phrase);
        }
        if let Some(level) = level {
            if last_level.elapsed() >= Duration::from_millis(50) {
                last_level = Instant::now();
                let _ = app.emit_to(WINDOW, "dictation:level", level);
            }
        }
    }
    drop(stream);
    if !cancel.load(Ordering::Relaxed) {
        if let Some(phrase) = cutter.finish() {
            let _ = phrases.send(phrase);
        }
    }
    Ok(())
}

fn transcribe(
    app: &AppHandle,
    state: &Dictation,
    path: &PathBuf,
    language: &'static str,
    vocabulary: &str,
    cancel: &AtomicBool,
    phrases: mpsc::Receiver<Vec<f32>>,
) -> Result<(), String> {
    let model = load_model(state, path)?;
    let mut whisper = model.create_state().map_err(|_| "Could not start the speech model")?;
    let threads = std::thread::available_parallelism().map(|n| n.get().min(4)).unwrap_or(2) as i32;
    let mut previous = String::new();
    for phrase in phrases {
        if cancel.load(Ordering::Relaxed) {
            return Ok(());
        }
        let context = format!("{vocabulary} {previous}");
        let text = recognise(&mut whisper, &phrase, language, context.trim(), threads)?;
        if cancel.load(Ordering::Relaxed) {
            return Ok(());
        }
        if let Some(text) = clean_transcript(&text) {
            previous = text.chars().rev().take(200).collect::<Vec<_>>().into_iter().rev().collect();
            let _ = app.emit_to(WINDOW, "dictation:phrase", text);
        }
    }
    Ok(())
}

/// One phrase through Whisper. Greedy decoding: beam search buys little on short dictated
/// phrases and costs several times the latency.
fn recognise(
    whisper: &mut whisper_rs::WhisperState,
    phrase: &[f32],
    language: &'static str,
    context: &str,
    threads: i32,
) -> Result<String, String> {
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some(language));
    params.set_n_threads(threads);
    params.set_no_context(true);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_suppress_blank(true);
    params.set_suppress_nst(true);
    params.set_no_speech_thold(0.6);
    params.set_audio_ctx(audio_context(phrase.len()));
    // Scape vocabulary plus the last phrase: names come out spelled right, and a sentence
    // split by a pause keeps its casing and punctuation.
    if !context.is_empty() {
        params.set_initial_prompt(context);
    }
    whisper.full(params, phrase).map_err(|_| "Transcription failed")?;
    Ok(whisper
        .as_iter()
        .filter(|segment| segment.no_speech_probability() < 0.8)
        .filter_map(|segment| segment.to_str_lossy().ok().map(|s| s.into_owned()))
        .collect())
}

/// Whisper always encodes a 30 s window, which is most of the cost for a 3 s phrase. Shrinking
/// the encoder context to the phrase (Whisper runs at 50 frames per second) plus headroom cuts
/// that cost roughly in proportion. Measured on a base M1 with turbo: ~4-5x real time instead
/// of ~1.3x. Less headroom, or flash attention, made short Hindi phrases repeat or garble.
fn audio_context(samples: usize) -> i32 {
    let seconds = samples as f32 / audio::TARGET_RATE as f32;
    ((seconds * 50.0) as i32 + 384).min(1500)
}

/// Frees the model after a quiet spell. Polling every 30 s costs nothing worth measuring.
pub fn start_idle_unloader(app: AppHandle) {
    whisper_rs::install_logging_hooks();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(30));
        let state = app.state::<Dictation>();
        let mut inner = state.inner.lock().unwrap();
        let idle = inner.last_used.map_or(true, |t| t.elapsed() > IDLE_UNLOAD);
        if inner.session.is_none() && inner.model.is_some() && idle {
            inner.model = None;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_supported_languages() {
        assert_eq!(language_code("hi"), Some("hi"));
        assert_eq!(language_code("auto"), None);
        assert_eq!(language_code(""), None);
    }

    #[test]
    fn prompt_is_bounded_and_printable() {
        assert_eq!(clean_prompt("Roadmap\0 Scapi\n"), "Roadmap Scapi");
        assert_eq!(clean_prompt(&"a".repeat(2_000)).len(), MAX_PROMPT_CHARS);
    }

    /// 16 kHz mono 32-bit float WAV, as written by `say --data-format=LEF32@16000`.
    fn read_wav(path: &str) -> Vec<f32> {
        let bytes = std::fs::read(path).unwrap();
        let data = bytes.windows(4).position(|w| w == b"data").unwrap() + 8;
        bytes[data..].chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect()
    }

    /// PRECIPICE_TEST_MODEL=path/to/ggml.bin PRECIPICE_TEST_AUDIO=en:a.wav,hi:b.wav
    #[test]
    #[ignore = "needs a local Whisper model and speech samples"]
    fn transcribes_real_speech() {
        let model = std::env::var("PRECIPICE_TEST_MODEL").unwrap();
        let mut params = WhisperContextParameters::default();
        params.use_gpu(true);
        let context = WhisperContext::new_with_params(&model, params).unwrap();
        let mut whisper = context.create_state().unwrap();
        for item in std::env::var("PRECIPICE_TEST_AUDIO").unwrap().split(',') {
            let (language, path) = item.split_once(':').unwrap();
            let language = language_code(language).unwrap();
            let mut audio = vec![0.0; 8_000];
            audio.extend(read_wav(path));
            audio.extend(vec![0.0; 16_000]);
            let mut cutter = PhraseCutter::default();
            let mut phrases = cutter.push(&audio).0;
            phrases.extend(cutter.finish());
            assert!(!phrases.is_empty(), "no speech found in {path}");
            let seconds = audio.len() as f32 / 16_000.0;
            let started = Instant::now();
            let text: Vec<String> = phrases
                .iter()
                .map(|p| recognise(&mut whisper, p, language, "Precipice Scapi scape", 4).unwrap())
                .collect();
            let took = started.elapsed().as_secs_f32();
            println!("{language} {seconds:.1}s audio in {took:.2}s ({:.1}x): {}", seconds / took, text.join(" | "));
        }
    }

    #[test]
    fn status_serializes_for_the_webview() {
        let json = serde_json::to_string(&Status::NeedsModel { bytes: 5 }).unwrap();
        assert_eq!(json, r#"{"kind":"needs-model","bytes":5}"#);
    }
}
