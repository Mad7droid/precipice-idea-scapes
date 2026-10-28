import { SETTING_KEYS } from "@/core/types";
import { settingsRepository } from "@/persistence/settings";
import type {
  DictationEngine,
  DictationHandlers,
  DictationLanguage,
  DictationStatus,
} from "./engine";

/**
 * Dictation in the browser, through the Web Speech API's on-device mode.
 *
 * `processLocally` is always true: the browser's own language pack transcribes, and audio is
 * never sent to a speech service. A browser without on-device recognition reports dictation as
 * unavailable rather than quietly falling back to a cloud recogniser — the privacy promise is
 * the same on web and Mac.
 */

const LOCALES: Record<DictationLanguage, string> = { en: "en-US", hi: "hi-IN", ml: "ml-IN" };

type Availability = "available" | "downloadable" | "downloading" | "unavailable";
interface RecognitionOptions {
  langs: string[];
  processLocally: boolean;
  quality?: "command" | "dictation" | "conversation";
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { transcript: string };
}
interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  phrases?: unknown[];
  onresult:
    ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(stream?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
}
interface RecognitionConstructor {
  new (): Recognition;
  available?: (options: RecognitionOptions) => Promise<Availability>;
  install?: (options: RecognitionOptions) => Promise<boolean>;
}
interface PhraseConstructor {
  new (phrase: string, boost?: number): unknown;
}

function recognitionClass(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as Record<string, unknown>;
  return (scope.SpeechRecognition ??
    scope.webkitSpeechRecognition ??
    null) as RecognitionConstructor | null;
}

const UNSUPPORTED =
  "This browser cannot transcribe speech on this device. Use a current Chrome or Edge, or the Precipice Mac app.";

export function webSpeechSupported(): boolean {
  const Recognition = recognitionClass();
  return !!Recognition && typeof Recognition.available === "function";
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access was blocked. Allow it for this site in your browser settings.",
  "service-not-allowed": "This browser blocked on-device speech recognition for this site.",
  "audio-capture": "No microphone was found. Check your input device and try again.",
  "language-not-supported": "This language is not available for on-device dictation here.",
  network: "On-device speech recognition is unavailable in this browser.",
};

/** Language packs are tens of MB; past this the wait is reported as failed rather than endless. */
export const INSTALL_TIMEOUT_MS = 5 * 60_000;

export function webEngine({
  installTimeoutMs = INSTALL_TIMEOUT_MS,
}: { installTimeoutMs?: number } = {}): DictationEngine {
  const listeners = new Set<DictationHandlers>();
  let installing = false;
  /** Ends the current wait for a language pack. The browser may keep downloading. */
  let stopWaiting: ((outcome: "cancelled" | "timeout") => void) | null = null;
  let session: {
    recognition: Recognition;
    stream: MediaStream | null;
    audio: AudioContext | null;
    timer: number;
    cancelled: boolean;
    stopping: boolean;
  } | null = null;

  const emit = <K extends keyof DictationHandlers>(
    kind: K,
    value: Parameters<NonNullable<DictationHandlers[K]>>[0],
  ) => {
    for (const handlers of listeners)
      (handlers[kind] as ((v: typeof value) => void) | undefined)?.(value);
  };
  const locale = async () =>
    LOCALES[
      (await settingsRepository.get<DictationLanguage>(SETTING_KEYS.dictationLanguage)) ?? "en"
    ];
  const options = (lang: string): RecognitionOptions => ({
    langs: [lang],
    processLocally: true,
    quality: "dictation",
  });
  // Prefer the dictation-quality model; browsers that only ship the default (command) model
  // report it unavailable or reject `quality`, so ask again without it before giving up.
  const query = async (
    method: "available" | "install",
    lang: string,
  ): Promise<Availability | boolean> => {
    const Recognition = recognitionClass();
    const call = Recognition?.[method] as
      ((options: RecognitionOptions) => Promise<Availability | boolean>) | undefined;
    if (!Recognition || !call) return method === "available" ? "unavailable" : false;
    const { langs, processLocally } = options(lang);
    try {
      const result = await call.call(Recognition, options(lang));
      if (result !== "unavailable" && result !== false) return result;
    } catch {
      // Fall through to the default quality.
    }
    return await call.call(Recognition, { langs, processLocally });
  };

  const status = async (): Promise<DictationStatus> => {
    if (!webSpeechSupported()) return { kind: "unavailable", reason: UNSUPPORTED };
    if (session) return { kind: session.stopping ? "finishing" : "listening" };
    const availability = (await query("available", await locale())) as Availability;
    if (availability === "available") return { kind: "ready" };
    if (availability === "downloading" || installing)
      return { kind: "installing", received: 0, total: 0 };
    if (availability === "downloadable") return { kind: "needs-model", bytes: 0 };
    return {
      kind: "error",
      message:
        "This browser has no on-device speech model for the chosen language. Pick another language in Settings → General, or use the Mac app.",
    };
  };

  const teardown = () => {
    if (!session) return;
    window.clearInterval(session.timer);
    session.stream?.getTracks().forEach((track) => track.stop());
    void session.audio?.close().catch(() => {});
    session = null;
    emit("level", 0);
  };

  /** The meter reads its own analyser; the recogniser never sees this stream's samples. */
  const meter = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audio = new AudioContext();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 1024;
      audio.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        emit("level", Math.sqrt(sum / samples.length));
      }, 50);
      return { stream, audio, timer };
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      throw new Error(
        name === "NotAllowedError" || name === "SecurityError"
          ? ERRORS["not-allowed"]
          : ERRORS["audio-capture"],
      );
    }
  };

  return {
    status,
    async install() {
      if (installing) return;
      installing = true;
      emit("status", { kind: "installing", received: 0, total: 0 });
      let timer = 0;
      const ended = new Promise<"cancelled" | "timeout">((resolve) => {
        stopWaiting = resolve;
        timer = window.setTimeout(() => resolve("timeout"), installTimeoutMs);
      });
      try {
        const outcome = await Promise.race([
          (async () => (await query("install", await locale())) as boolean)(),
          ended,
        ]);
        emit(
          "status",
          outcome === true
            ? { kind: "ready" }
            : outcome === "cancelled"
              ? { kind: "needs-model", bytes: 0 }
              : {
                  kind: "error",
                  message:
                    outcome === "timeout"
                      ? "The language pack is taking too long to download. Check your connection and try again."
                      : "The browser could not download its speech model. Try again later.",
                },
        );
      } catch {
        emit("status", {
          kind: "error",
          message: "The browser could not download its speech model. Try again later.",
        });
      } finally {
        window.clearTimeout(timer);
        stopWaiting = null;
        installing = false;
      }
    },
    // Browsers expose no way to stop a language-pack download, so this stops waiting for it.
    cancelInstall: async () => {
      stopWaiting?.("cancelled");
    },
    prepare: async () => {},
    async start({ language, prompt }) {
      const Recognition = recognitionClass();
      if (!Recognition || !webSpeechSupported()) throw new Error(UNSUPPORTED);
      if (session) return;
      const lang = LOCALES[language];
      if ((await query("available", lang)) !== "available")
        throw new Error(ERRORS["language-not-supported"]);
      const { stream, audio, timer } = await meter();
      const recognition = new Recognition();
      recognition.lang = lang;
      recognition.continuous = true;
      // Interim text is shown live and never inserted; only final phrases reach the draft.
      recognition.interimResults = true;
      recognition.processLocally = true;
      // Contextual biasing toward the scape's titles, where the browser supports it.
      const Phrase = (window as unknown as { SpeechRecognitionPhrase?: PhraseConstructor })
        .SpeechRecognitionPhrase;
      if (Phrase && "phrases" in recognition) {
        try {
          recognition.phrases = prompt
            .split(/[,\n]/)
            .map((term) => term.trim())
            .filter((term) => term.length > 1)
            .slice(0, 50)
            .map((term) => new Phrase(term, 3));
        } catch {
          // Biasing is optional; plain recognition still works.
        }
      }
      const current = { recognition, stream, audio, timer, cancelled: false, stopping: false };
      session = current;
      recognition.onresult = (event) => {
        if (current.cancelled) return;
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result?.[0].transcript.trim() ?? "";
          if (!text) continue;
          if (result!.isFinal) emit("phrase", text);
          else interim += (interim ? " " : "") + text;
        }
        emit("partial", interim);
      };
      recognition.onerror = (event) => {
        if (current.cancelled || event.error === "aborted" || event.error === "no-speech") return;
        current.cancelled = true;
        if (session === current) teardown();
        emit("status", {
          kind: "error",
          message: ERRORS[event.error] ?? "Dictation stopped unexpectedly. Try again.",
        });
      };
      recognition.onend = () => {
        emit("partial", "");
        // Browsers end a session after a stretch of silence. Until the person stops, keep
        // listening: a pause is not the end of dictation.
        if (!current.cancelled && !current.stopping && session === current) {
          try {
            recognition.start();
            return;
          } catch {
            // Fall through and finish normally.
          }
        }
        if (session === current) teardown();
        if (!current.cancelled) emit("status", { kind: "ready" });
      };
      try {
        recognition.start();
      } catch (error) {
        teardown();
        throw error instanceof Error ? error : new Error(String(error));
      }
    },
    async stop() {
      if (!session) return;
      session.stopping = true;
      session.recognition.stop();
    },
    async cancel() {
      if (!session) return;
      const current = session;
      current.cancelled = true;
      teardown();
      current.recognition.abort();
      emit("status", { kind: "ready" });
    },
    subscribe(handlers) {
      listeners.add(handlers);
      return () => listeners.delete(handlers);
    },
  };
}
