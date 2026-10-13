# Dictation implementation plan

Status: phase 1 (desktop) implemented; phase 0 hosting needs the R2 bucket and `PRECIPICE_MODELS_URL`. Speak to Scapi and get editable text in the composer. Fully local, free,
models served from our own Cloudflare R2. Scapi does not speak back.

## Decisions

| Topic | Decision |
| --- | --- |
| Engine (desktop) | whisper.cpp via `whisper-rs`, Metal, audio captured in Rust with `cpal` |
| Engine (web) | `transformers.js` in a Web Worker, WebGPU with WASM fallback |
| Engine (mobile, later) | System keyboard dictation first; PWA on the web engine next; native later |
| Models | Whisper `large-v3-turbo` (ggml q5_0 ~574 MB / ONNX); `small` q5 fallback on slow hardware; `base` for web WASM |
| Languages | English, Hindi (phase 1); Malayalam fine-tune pack (phase 3) |
| Hosting | Dedicated R2 bucket + custom domain, separate from the publication bucket. No Hugging Face at runtime |
| Integrity | `manifest.json` with size + SHA-256 per model; verified before load; app pins the origin |
| Privacy | Audio never written to disk, IndexedDB, or logs. Only text reaches the composer |
| UX | Mic button beside Send; click to toggle; Esc discards; phrases appear as you pause; never auto-send (Cmd+Enter sends) |

## Shared contract

`src/dictation/engine.ts`

```ts
export type DictationStatus =
  | { kind: "unavailable"; reason: string }
  | { kind: "needs-model"; bytes: number }
  | { kind: "installing"; received: number; total: number }
  | { kind: "ready" }
  | { kind: "listening" }
  | { kind: "finishing" }
  | { kind: "error"; message: string };

export interface DictationEngine {
  status(): Promise<DictationStatus>;
  install(signal?: AbortSignal): Promise<void>;
  start(opts: { language: "en" | "hi" | "ml"; prompt?: string }): Promise<void>;
  stop(): Promise<void>; // flush last phrase
  cancel(): Promise<void>; // discard
  on(event: "level", fn: (rms: number) => void): () => void;
  on(event: "phrase", fn: (text: string) => void): () => void;
  on(event: "status", fn: (s: DictationStatus) => void): () => void;
}
```

`createDictationEngine()` picks the Tauri adapter when `isDesktop()`, otherwise the web adapter.

## Phase 0: hosting (0.5 day)

1. Create R2 bucket `precipice-models` with a custom domain (not `r2.dev`).
2. Upload ggml `large-v3-turbo-q5_0`, `small-q5_1`, and the ONNX web models.
3. Generate `manifest.json` (`id`, `runtime`, `languages`, `bytes`, `sha256`, `url`) with a
   script in `scripts/`; commit only the script and the pinned manifest hash, not the models.
4. CORS on the bucket for the web origin only.

## Phase 1: desktop, English + Hindi (~10–13 days)

| Step | Files | Days |
| --- | --- | --- |
| Contract, `useDictation` hook, engine picker | `src/dictation/*` | 1 |
| Mic capture → 16 kHz mono, energy VAD, phrase queue | `src-tauri/src/dictation/audio.rs` | 1.5 |
| `whisper-rs` + Metal, idle unload, language + initial prompt, silence/hallucination guard | `src-tauri/src/dictation/engine.rs` | 1.5–2 |
| Installer: download from pinned origin, resume, SHA-256, atomic move to app data | `src-tauri/src/dictation/models.rs` | 1–1.5 |
| Commands + events (`dictation_status/install/start/stop/cancel`); capability entries | `main.rs`, `capabilities/main.json`, `permissions/` | 0.5 |
| `NSMicrophoneUsageDescription`, audio-input entitlement | `src-tauri/Info.plist`, `tauri.conf.json` | 0.5 |
| First-run speed check → turbo vs `small` | `engine.rs` | 0.5 |
| UI: `MicButton`, waveform, timer, states, Esc; wire into `ScapiComposer` and `Composer`; language in settings | `src/ai/Composer.tsx`, `src/ai/scapi/ScapiPanel.tsx`, `src/dictation/MicButton.tsx` | 2–2.5 |
| Vocabulary prompt from current scape object titles | `src/dictation/prompt.ts` | 0.25 |
| Tests: Vitest (mocked `invoke`), cargo tests (resample, VAD, hash) | colocated | included |
| Docs + CI: `security-and-local-data.md`, `desktop.md`, `CHANGELOG.md`; confirm `desktop-macos.yml` builds whisper.cpp | | 0.5–1 |
| QA on real English / Hindi / Hinglish recordings, tuning | | 1–2 |

Exit criteria: 10 s English dictation shows text within ~1 s of stop on M-series; Hindi usable
on a 20-sentence personal test set; no audio files anywhere on disk; denied mic shows guidance.

## Phase 2: web (~4–6 days)

1. Web adapter: `getUserMedia` + AudioWorklet resample, worker running `transformers.js`.
2. WebGPU → turbo; otherwise `base`. Models fetched from R2, kept in Cache Storage, SHA-256
   checked.
3. `public/_headers`: add `'wasm-unsafe-eval'` and the R2 origin to `connect-src`; update
   `csp.test.ts`.
4. Lazy-load the engine chunk so the editor bundle does not grow.
5. Data-saver / large-download confirmation before install.

## Phase 3: Malayalam (1–2 days)

Convert a Malayalam Whisper fine-tune to ggml/ONNX, confirm its licence, add to manifest,
evaluate on own recordings. IndicConformer only if this fails (second runtime, +3–5 days).

## Phase 4: mobile (later)

Rely on system keyboard dictation first; then PWA on the web engine with `base`/`small`; a
native app is a separate project.

## Phase 1 measurements (base M1, 8 GB, turbo q5_0, Metal)

| Setting | English 5.4 s | Hindi 3.7 s | Hindi 6.2 s |
| --- | --- | --- | --- |
| Default 30 s window | 1.3x real time | 1.2x | — |
| Window sized to phrase + 384 frames (shipped) | 5.7x, correct | 4.2x, correct | 5.0x, correct |
| + flash attention, or less headroom | faster | garbled or repeated | — |

Samples were macOS `say` voices (Samantha, Lekha), not real speakers; QA on real recordings
is still open. Intel Macs get Whisper small (4x real time on M1, weaker Hindi spelling).

## Risks

- `whisper-rs` / cmake under CI, signing and notarisation (largest unknown).
- Hindi/Hinglish quality on turbo; measure before promising.
- Whisper hallucination on silence; the VAD gate must drop empty phrases.
- Intel Macs: fall back to `small` or disable with a clear message.
