import { isDesktop } from "@/desktop/runtime";

/**
 * Speech to text, on this device. Every platform implements the same contract so the composer
 * UI never knows which engine is behind it: the desktop app runs whisper.cpp natively; a web
 * engine can slot in later without touching the button or the hook.
 */
export type DictationLanguage = "en" | "hi" | "ml";

export const DICTATION_LANGUAGES: { value: DictationLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "hi", label: "हिन्दी · Hindi" },
  { value: "ml", label: "മലയാളം · Malayalam (experimental)" },
];

export type DictationStatus =
  | { kind: "unavailable"; reason: string }
  | { kind: "needs-model"; bytes: number }
  | { kind: "installing"; received: number; total: number }
  | { kind: "ready" }
  | { kind: "listening" }
  | { kind: "finishing" }
  | { kind: "error"; message: string };

export interface DictationHandlers {
  status?: (status: DictationStatus) => void;
  /** Microphone energy, roughly 0–0.3, about twenty times a second while listening. */
  level?: (rms: number) => void;
  /** A finished phrase, in order. Never partial text that is later revised. */
  phrase?: (text: string) => void;
}

export interface DictationEngine {
  status(): Promise<DictationStatus>;
  install(): Promise<void>;
  cancelInstall(): Promise<void>;
  /** Warm the model so the first phrase does not wait on disk. Safe to call often. */
  prepare(): Promise<void>;
  start(options: { language: DictationLanguage; prompt: string }): Promise<void>;
  /** Stop listening; phrases already heard still arrive. */
  stop(): Promise<void>;
  /** Stop listening and drop anything not yet delivered. */
  cancel(): Promise<void>;
  subscribe(handlers: DictationHandlers): () => void;
}

const unavailable: DictationEngine = {
  status: async () => ({
    kind: "unavailable",
    reason: "Dictation runs in the Precipice desktop app for now.",
  }),
  install: async () => {},
  cancelInstall: async () => {},
  prepare: async () => {},
  start: async () => {},
  stop: async () => {},
  cancel: async () => {},
  subscribe: () => () => {},
};

function tauriEngine(): DictationEngine {
  const core = () => import("@tauri-apps/api/core");
  const call = async <T = void>(command: string, args?: Record<string, unknown>) =>
    (await core()).invoke<T>(command, args);
  return {
    status: () => call<DictationStatus>("dictation_status"),
    install: () => call("dictation_install"),
    cancelInstall: () => call("dictation_cancel_install"),
    prepare: () => call("dictation_prepare"),
    start: ({ language, prompt }) => call("dictation_start", { language, prompt }),
    stop: () => call("dictation_stop"),
    cancel: () => call("dictation_cancel"),
    subscribe(handlers) {
      let closed = false;
      const unlisteners: (() => void)[] = [];
      void import("@tauri-apps/api/event").then(async ({ listen }) => {
        const pairs = [
          ["dictation:status", handlers.status],
          ["dictation:level", handlers.level],
          ["dictation:phrase", handlers.phrase],
        ] as const;
        for (const [event, handler] of pairs) {
          if (!handler) continue;
          const unlisten = await listen<never>(event, ({ payload }) =>
            (handler as (value: unknown) => void)(payload),
          );
          if (closed) unlisten();
          else unlisteners.push(unlisten);
        }
      });
      return () => {
        closed = true;
        unlisteners.forEach((unlisten) => unlisten());
      };
    },
  };
}

let engine: DictationEngine | null = null;

export function dictationEngine(): DictationEngine {
  engine ??= isDesktop() ? tauriEngine() : unavailable;
  return engine;
}

/** Tests swap the engine; nothing else should. */
export function setDictationEngineForTests(next: DictationEngine | null) {
  engine = next;
}
