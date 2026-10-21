import { useCallback, useEffect, useRef, useState } from "react";
import { heuristicRoute } from "./heuristics";
import { merge } from "./decide";
import type { RouteContext, RouteSuggestion } from "./types";

/** Chips settle this long after typing pauses, so they never jitter under the cursor. */
export const ROUTE_DEBOUNCE_MS = 500;
const MIN_JEV_WORDS = 3;
const CACHE_SIZE = 20;

export interface UseRouteOptions {
  text: string;
  enabled: boolean;
  /** A TypeSafe key, when the person has opted in to Jev. Empty means heuristics only. */
  jevKey: string;
  /** Read when a route is computed, never per keystroke. */
  getContext: () => RouteContext;
}

/**
 * What Jev did for the current draft, so the composer can say who decided. `off` means no key,
 * Jev disabled or a draft too short to ask about; `fallback` means Jev failed or timed out and
 * the on-device suggestion stands.
 */
export type JevStatus = "off" | "asking" | "answered" | "fallback";

function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The current routing suggestion for one composer's draft.
 *
 * Runs after a pause, or immediately when a dictated phrase lands. Heuristics answer at once;
 * Jev, if enabled, refines the same draft a few hundred milliseconds later. One Jev request is
 * in flight per composer and a newer draft aborts it. Nothing here ever blocks sending: a send
 * uses whatever suggestion is current, including none.
 */
export function useRoute({ text, enabled, jevKey, getContext }: UseRouteOptions) {
  const [suggestion, setSuggestion] = useState<RouteSuggestion | null>(null);
  const [pending, setPending] = useState(false);
  const [jev, setJev] = useState<JevStatus>("off");
  const held = useRef(false);
  const queued = useRef<RouteSuggestion | null | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, RouteSuggestion | null>());
  const contextRef = useRef(getContext);
  contextRef.current = getContext;
  const voiceNext = useRef(false);

  const publish = useCallback((next: RouteSuggestion | null) => {
    // A chip under the pointer, or with its menu open, does not change until it is released.
    if (held.current) queued.current = next;
    else setSuggestion(next);
  }, []);

  const run = useCallback(
    (draft: string) => {
      const normalized = normalise(draft);
      const context = contextRef.current();
      const key = normalized ? JSON.stringify([normalized, context]) : "";
      controller.current?.abort();
      controller.current = null;
      if (!key) {
        setPending(false);
        setJev("off");
        publish(null);
        return;
      }
      const local = heuristicRoute(draft, context);
      publish(local);

      if (!jevKey.trim() || normalized.split(" ").length < MIN_JEV_WORDS) {
        setPending(false);
        setJev("off");
        return;
      }
      const cached = cache.current.get(key);
      if (cached !== undefined) {
        publish(merge(local, cached));
        setPending(false);
        setJev(cached ? "answered" : "fallback");
        return;
      }
      const current = new AbortController();
      controller.current = current;
      setPending(true);
      setJev("asking");
      void import("./jev")
        .then(({ askJev }) => askJev(draft, context, jevKey, current.signal))
        .then((answer) => {
          if (current.signal.aborted) return;
          cache.current.set(key, answer);
          if (cache.current.size > CACHE_SIZE) {
            cache.current.delete(cache.current.keys().next().value!);
          }
          publish(merge(local, answer));
          setJev(answer ? "answered" : "fallback");
        })
        .catch(() => {
          if (!current.signal.aborted) setJev("fallback");
        })
        .finally(() => {
          if (controller.current === current) {
            controller.current = null;
            setPending(false);
          }
        });
    },
    [jevKey, publish],
  );

  // A new key, or turning Jev off, must not leave an answer from the old one in place.
  useEffect(() => {
    cache.current.clear();
  }, [jevKey]);

  useEffect(() => {
    controller.current?.abort();
    controller.current = null;
    queued.current = undefined;
    setSuggestion(null);
    setPending(false);
    setJev("off");
    if (!enabled) {
      setSuggestion(null);
      setPending(false);
      return;
    }
    if (!text.trim()) {
      run("");
      return;
    }
    if (voiceNext.current) {
      voiceNext.current = false;
      run(text);
      return;
    }
    const timer = window.setTimeout(() => run(text), ROUTE_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.current?.abort();
    };
  }, [enabled, run, text]);

  useEffect(() => () => controller.current?.abort(), []);

  /** Marks the next draft change as a dictated phrase, which routes without waiting. */
  const phraseLanded = useCallback(() => {
    voiceNext.current = true;
  }, []);

  const hold = useCallback((on: boolean) => {
    held.current = on;
    if (!on && queued.current !== undefined) {
      setSuggestion(queued.current);
      queued.current = undefined;
    }
  }, []);

  return {
    suggestion: enabled ? suggestion : null,
    pending,
    jev: enabled ? jev : ("off" as JevStatus),
    hold,
    phraseLanded,
  };
}
