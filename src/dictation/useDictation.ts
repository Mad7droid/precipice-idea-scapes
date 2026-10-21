import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { SETTING_KEYS } from "@/core/types";
import { useScapeStore } from "@/core/store";
import { settingsRepository } from "@/persistence/settings";
import { dictationEngine, type DictationLanguage, type DictationStatus } from "./engine";
import { createLevelSignal, type LevelSignal } from "./level";
import { dictationVocabulary } from "./vocabulary";

export interface Dictation {
  status: DictationStatus | null;
  /** True while this composer's session is live — another composer's session is not ours. */
  active: boolean;
  level: LevelSignal;
  startedAt: number | null;
  toggle: () => void;
  cancel: () => void;
  install: () => void;
  cancelInstall: () => void;
  prepare: () => void;
  handleShortcut: (event: ReactKeyboardEvent) => boolean;
}

let sessionOwner: symbol | null = null;

/**
 * One composer's view of the shared dictation engine. Several composers can be on screen, but
 * only the one that started a session receives its phrases.
 */
export function useDictation(onPhrase: (text: string) => void): Dictation {
  const engine = dictationEngine();
  const [status, setStatus] = useState<DictationStatus | null>(null);
  const [level] = useState(createLevelSignal);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const owns = useRef(false);
  const identity = useRef(Symbol("dictation composer"));
  const startup = useRef<Promise<void> | null>(null);
  const deliver = useRef(onPhrase);
  deliver.current = onPhrase;

  useEffect(() => {
    let alive = true;
    void engine
      .status()
      .then((next) => alive && setStatus(next))
      .catch((error) => {
        if (alive) setStatus({ kind: "error", message: String(error) });
      });
    const unsubscribe = engine.subscribe({
      status: (next) => {
        setStatus(next);
        if (next.kind !== "starting" && next.kind !== "listening" && next.kind !== "finishing") {
          if (sessionOwner === identity.current) sessionOwner = null;
          owns.current = false;
          setStartedAt(null);
          level.set(0);
        }
      },
      level: (rms) => owns.current && level.set(rms),
      phrase: (text) => owns.current && deliver.current(text),
    });
    return () => {
      alive = false;
      unsubscribe();
      if (owns.current)
        void Promise.resolve(startup.current)
          .then(() => engine.cancel())
          .catch(() => {});
      if (sessionOwner === identity.current) sessionOwner = null;
      owns.current = false;
    };
  }, [engine, level]);

  const runStart = useCallback(async () => {
    if (sessionOwner !== null) return;
    sessionOwner = identity.current;
    owns.current = true;
    setStatus({ kind: "starting" });
    try {
      const stored = await settingsRepository.get<DictationLanguage>(
        SETTING_KEYS.dictationLanguage,
      );
      if (!owns.current) return;
      await engine.start({
        language: stored ?? "en",
        prompt: dictationVocabulary(useScapeStore.getState().scape),
      });
      if (owns.current) {
        setStartedAt(Date.now());
        setStatus({ kind: "listening" });
      }
    } catch (error) {
      if (sessionOwner === identity.current) sessionOwner = null;
      owns.current = false;
      setStartedAt(null);
      setStatus({ kind: "error", message: String(error) });
    }
  }, [engine]);

  const start = useCallback(() => {
    startup.current = runStart();
    return startup.current;
  }, [runStart]);

  const fail = useCallback(
    (error: unknown) => {
      if (sessionOwner === identity.current) sessionOwner = null;
      owns.current = false;
      setStartedAt(null);
      level.set(0);
      setStatus({ kind: "error", message: String(error) });
    },
    [level],
  );

  const cancel = useCallback(() => {
    if (!owns.current) return;
    // Stop delivering immediately, including phrases queued before the native cancel arrives.
    owns.current = false;
    setStartedAt(null);
    level.set(0);
    void Promise.resolve(startup.current)
      .then(() => engine.cancel())
      .then(() => {
        if (sessionOwner === identity.current) sessionOwner = null;
        setStatus({ kind: "ready" });
      })
      .catch(fail);
  }, [engine, fail, level]);

  const toggle = useCallback(() => {
    if (owns.current && status?.kind === "listening") {
      setStatus({ kind: "finishing" });
      void engine.stop().catch(fail);
    } else if (status?.kind === "ready" || status?.kind === "error") void start();
  }, [engine, fail, start, status]);

  // Esc stops and discards pending audio; text already delivered stays editable.
  const active =
    owns.current &&
    (status?.kind === "starting" || status?.kind === "listening" || status?.kind === "finishing");
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, cancel]);

  return {
    handleShortcut: (event) => {
      if (
        event.key !== " " ||
        !event.shiftKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.nativeEvent.isComposing
      )
        return false;
      if (!active && status?.kind !== "ready" && status?.kind !== "error") return false;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) toggle();
      return true;
    },
    status,
    active,
    level,
    startedAt,
    toggle,
    cancel,
    install: () =>
      void engine.install().catch((e) => setStatus({ kind: "error", message: String(e) })),
    cancelInstall: () => void engine.cancelInstall().catch(fail),
    prepare: () => {
      if (status?.kind === "ready") void engine.prepare().catch(fail);
    },
  };
}
