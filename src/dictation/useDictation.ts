import { useCallback, useEffect, useRef, useState } from "react";
import { SETTING_KEYS } from "@/core/types";
import { useScapeStore } from "@/core/store";
import { settingsRepository } from "@/persistence/settings";
import { dictationEngine, type DictationLanguage, type DictationStatus } from "./engine";
import { dictationVocabulary } from "./vocabulary";

export interface Dictation {
  status: DictationStatus | null;
  /** True while this composer's session is live — another composer's session is not ours. */
  active: boolean;
  level: number;
  startedAt: number | null;
  toggle: () => void;
  cancel: () => void;
  install: () => void;
  cancelInstall: () => void;
  prepare: () => void;
}

/**
 * One composer's view of the shared dictation engine. Several composers can be on screen, but
 * only the one that started a session receives its phrases.
 */
export function useDictation(onPhrase: (text: string) => void): Dictation {
  const engine = dictationEngine();
  const [status, setStatus] = useState<DictationStatus | null>(null);
  const [level, setLevel] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const owns = useRef(false);
  const deliver = useRef(onPhrase);
  deliver.current = onPhrase;

  useEffect(() => {
    let alive = true;
    void engine.status().then((next) => alive && setStatus(next));
    const unsubscribe = engine.subscribe({
      status: (next) => {
        setStatus(next);
        if (next.kind !== "listening" && next.kind !== "finishing") {
          owns.current = false;
          setStartedAt(null);
          setLevel(0);
        }
      },
      level: (rms) => owns.current && setLevel(rms),
      phrase: (text) => owns.current && deliver.current(text),
    });
    return () => {
      alive = false;
      unsubscribe();
      if (owns.current) void engine.cancel();
    };
  }, [engine]);

  const start = useCallback(async () => {
    const stored = await settingsRepository.get<DictationLanguage>(SETTING_KEYS.dictationLanguage);
    owns.current = true;
    setStartedAt(Date.now());
    setStatus({ kind: "listening" });
    try {
      await engine.start({
        language: stored ?? "en",
        prompt: dictationVocabulary(useScapeStore.getState().scape),
      });
    } catch (error) {
      owns.current = false;
      setStartedAt(null);
      setStatus({ kind: "error", message: String(error) });
    }
  }, [engine]);

  const cancel = useCallback(() => {
    if (owns.current) void engine.cancel();
  }, [engine]);

  const toggle = useCallback(() => {
    if (owns.current && status?.kind === "listening") void engine.stop();
    else if (status?.kind === "ready" || status?.kind === "error") void start();
  }, [engine, start, status]);

  // Esc discards — the one way out that leaves the draft exactly as it was.
  const active = owns.current && (status?.kind === "listening" || status?.kind === "finishing");
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
    status,
    active,
    level,
    startedAt,
    toggle,
    cancel,
    install: () =>
      void engine.install().catch((e) => setStatus({ kind: "error", message: String(e) })),
    cancelInstall: () => void engine.cancelInstall(),
    prepare: () => {
      if (status?.kind === "ready") void engine.prepare();
    },
  };
}
