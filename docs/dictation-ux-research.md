# Dictation interactions: research and implementation

Reviewed 2026-10-14. Scope: local speech-to-text in the canvas and Scapi composers,
with the same interaction contract for the future web and mobile engines. Audio never
becomes a sent message or an attachment. This document records visual evidence from
Mobbin separately from our interaction recommendations; screenshots cannot establish
keyboard shortcuts, animation timing, permission behavior or transcription accuracy.

## Mobbin evidence

| Reference                                                                                     | Observed in the returned screenshots                                                                                                        | Application here                                                                                   |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [ChatGPT recording](https://mobbin.com/screens/874aee2b-7f1c-4a52-9751-c36de1f13b01)          | Composer contains a waveform, an X and a checkmark.                                                                                         | Keep recording inline, with distinct cancel and finish actions.                                    |
| [Mistral recording](https://mobbin.com/screens/7411b9f0-68ad-4585-98bb-d3b13384de4b)          | Waveform sits inside the composer above an X, elapsed time and an arrow.                                                                    | Use voice level and elapsed time as recording feedback; keep our finish action separate from Send. |
| [Google AI Studio recording](https://mobbin.com/screens/acb4e51e-d9ab-4032-9293-239f958d586d) | Recording is a modal with a red record indicator, close and Stop recording.                                                                 | A useful alternative for audio attachments; inline controls fit our editable-text task better.     |
| [Messages dictation flow](https://mobbin.com/flows/8590d85e-6824-43c7-aab2-a8efa642de50)      | Mic in the initial composer; a later screen shows dictated text, an active mic indicator and Send; the final screen shows the sent message. | Preserve review and editing before explicit sending on future mobile.                              |
| [Meta AI dictation flow](https://mobbin.com/flows/8cded063-8a94-4d0f-ba59-feeff34c333e)       | Composer mic; later screens show editable text with the keyboard and Send, with an active then idle mic icon.                               | Keep typing and dictation in one draft. Distinguish microphone input from voice conversation.      |

These are reference patterns, not proof of a universally best interaction. No latency or
motion behavior was measured from Mobbin, and the returned flows did not establish the
microphone-permission sequence. No cloud transcription behavior is adopted.

## Shared behavior

- Click or tap the mic to start; finish keeps all heard phrases and flushes the last one.
- Show **Starting…** until the native start command succeeds, then **Listening**, a level
  meter and elapsed time. Show **Finishing…** after Stop. Startup and finish remain cancellable.
- A separate X and Escape cancel pending audio immediately. Text already inserted remains
  editable. This avoids deleting typing or corrections made during dictation.
- Disable Send and Cmd/Ctrl+Enter while this composer's dictation is active. Never send an
  incomplete phrase or automatically submit after Stop. Plain Enter remains a newline.
- Cmd/Ctrl+Shift+Space starts or stops from the focused composer field. Ignore key repeat and
  IME composition. Scope the shortcut to that field; do not intercept Space globally or add
  hold-to-talk gestures that conflict with writing, canvas pan or mobile accessibility.
- Only one composer owns a session, including asynchronous startup. Other composers cannot
  acquire it or receive its phrases. Cancelling during startup waits for startup to settle
  before issuing native cancellation, so permission/model startup cannot leave a hidden mic.
- Keep an existing draft on permission, capture, transcription or installation errors. Show
  the error with explicit Close and Try again actions instead of silently restarting when
  the person opens the error indicator.
- Install only after the person accepts the first-use model size. Keep download cancellable,
  expose semantic progress and clamp its displayed percentage. Closing this prompt does not
  start recording or accept a download. Escape returns focus to the trigger.
- Keep language selection in Settings for now; English and Hindi remain primary, Malayalam
  experimental. An inline language selector is a later improvement, especially on mobile.

## Motion and accessibility

Use the existing semantic colors, radii, duration and easing tokens. The recording meter
uses fixed-height bars scaled with `transform`, rather than changing their height on every
level event. It reacts to actual mic energy and does not imply speech during silence.
Reduced motion replaces moving bars with static bars while the Listening label and timer
continue to communicate state. The first-use/error surface enters from the mic anchor using
the existing node-enter animation; reduced motion removes that animation. No decorative
pulse, background recording animation or delayed keyboard action is introduced.

Recording and finishing labels have status semantics; the timer is separate from announcements.
Download progress has a progressbar role; errors have alert semantics. Cancel remains usable
while finish is busy. The setup/error surface is nonmodal, with action focus on entry and
Escape dismissal. Physical touch-target and screen-reader checks remain part of mobile QA;
the current desktop controls are not a claim of mobile acceptance.

## Implementation and remaining work

Implemented in `src/dictation/MicButton.tsx`, `useDictation.ts`, and both composers.
Regression coverage exercises late phrases after cancel, startup cancellation, competing
composers, shortcut repeat suppression, language delivery and setup keyboard focus.

The engine still runs only in the macOS app. Web and PWA adapters remain phase 2/4 work;
do not offer a cloud Web Speech fallback under the local-only promise. Cloudflare hosting
still requires the model bucket/custom domain and a build with `PRECIPICE_MODELS_URL`.
The native publisher script verifies pinned model bytes before uploading. Model acquisition
is a one-time fetch from our Cloudflare origin; serving it there does not eliminate local
model transfer, storage or inference memory.

Before release: run the configured macOS build/signing path; test actual English, Hindi and
Hinglish speech, mic denial and interruptions on hardware; measure cold start, stop-to-text
latency and idle memory. The prior synthetic-voice measurements do not replace those checks.
Future mobile should preserve review-before-send, use touch-sized controls and test keyboard,
app backgrounding, interruptions and large-download consent on physical devices. Never assume
system-keyboard dictation satisfies our audio privacy guarantee without platform verification.
