import { useCallback, useEffect, useRef, useState } from "react";
import type { ObjectId, Scape } from "@/core/types";
import { applyAskEvent, isComplete, startTurn } from "./reducer";
import type { AskEvent, ModelTurn, SearchAvailability, Turn } from "./types";

/**
 * Scapey's state for one scape.
 *
 * Two stores, deliberately not derived from each other:
 *
 * - `turns` is the **display transcript** — what the panel renders.
 * - `history` is the **model context** — provider-shaped messages, kept verbatim in a ref.
 *
 * The ref is not state because nothing renders from it and every write to it happens mid-stream;
 * putting it in `useState` would re-render the panel for data the panel never reads.
 */

/**
 * Provider chunks are not human-sized. Re-rendering Markdown as they arrive makes paragraphs
 * jump even with a character buffer, because list and link structure keeps changing. Scapey
 * therefore buffers prose off-screen and paints the complete response in one stable render;
 * the activity trail makes the wait legible without typewriter theatre.
 */

export interface UseScapeyOptions {
  /** Read at send time rather than captured, so a question always sees the current canvas. */
  getScape: () => Scape | null;
  /** Objects selected on the canvas right now. */
  getSelection?: () => ObjectId[];
  apiKey: string;
  modelId: string;
  scapeId?: string;
}

export function useScapey({ getScape, getSelection, apiKey, modelId, scapeId }: UseScapeyOptions) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [webSearch, setWebSearch] = useState(true);
  const [searchAvailability, setSearchAvailability] = useState<SearchAvailability>("unknown");
  const [restored, setRestored] = useState(false);

  const history = useRef<ModelTurn[]>([]);
  const controller = useRef<AbortController | null>(null);

  const queue = useRef({ text: "", reasoning: "" });
  /** Prevent the initial empty render from overwriting a transcript before it has been read. */
  const storageHydrated = useRef(false);

  const storageKey = scapeId ? `precipice.scapey.${scapeId}` : null;

  // Display history is safe to retain; provider messages (including encrypted search content)
  // deliberately remain only in memory, so a reload starts a fresh model conversation.
  useEffect(() => {
    storageHydrated.current = false;
    history.current = [];
    setTurns([]);
    setRestored(false);
    if (!storageKey) {
      storageHydrated.current = true;
      return;
    }
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Turn[];
        if (Array.isArray(parsed)) {
          setTurns(parsed.filter((turn) => turn.status !== "streaming").slice(-10));
          setRestored(parsed.length > 0);
        }
      }
    } catch {
      // Corrupt or unavailable sessionStorage should never stop the live conversation.
    } finally {
      storageHydrated.current = true;
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || streaming || !storageHydrated.current) return;
    try {
      let persisted = turns.slice(-10);
      // Keep an unexpectedly long research response from consuming the entire tab quota.
      for (let attempts = 0; attempts < 3; attempts++) {
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(persisted));
          return;
        } catch {
          persisted = persisted.slice(1);
        }
      }
    } catch {
      // Live state stays available even when browser storage is exhausted or disabled.
    }
  }, [storageKey, streaming, turns]);

  const updateLast = useCallback((apply: (turn: Turn) => Turn) => {
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice();
      next[next.length - 1] = apply(next[next.length - 1]);
      return next;
    });
  }, []);

  const commit = useCallback(
    (event: AskEvent) => {
      updateLast((turn) => applyAskEvent(turn, event));
      if (event.kind === "done" && event.turn) history.current.push(event.turn);
    },
    [updateLast],
  );

  /** Paint all accumulated Markdown only when its structure has stopped changing. */
  const drainNow = useCallback(() => {
    const { text, reasoning } = queue.current;
    queue.current = { text: "", reasoning: "" };
    if (reasoning)
      updateLast((turn) => applyAskEvent(turn, { kind: "reasoning", text: reasoning }));
    if (text) updateLast((turn) => applyAskEvent(turn, { kind: "text", text }));
  }, [updateLast]);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  const handleEvent = useCallback(
    (event: AskEvent) => {
      switch (event.kind) {
        case "text":
          queue.current.text += event.text;
          return;

        case "reasoning":
          queue.current.reasoning += event.text;
          return;

        case "done":
          drainNow();
          commit(event);
          setStreaming(false);
          return;

        default:
          // Activity and sources are low-frequency and ordering-sensitive relative to each
          // other, but not to the text — a status line may lead the prose it describes.
          if (event.kind === "search-unavailable") setSearchAvailability("unavailable");
          else commit(event);
          return;
      }
    },
    [commit, drainNow],
  );

  const send = useCallback(
    async (question: string) => {
      const scape = getScape();
      if (!scape || !question.trim() || streaming) return;

      const pinned = getSelection?.() ?? [];
      controller.current?.abort();
      controller.current = new AbortController();

      queue.current = { text: "", reasoning: "" };
      setTurns((prev) => [...prev, startTurn(question.trim(), pinned)]);
      setStreaming(true);

      try {
        // The provider SDK is large and is already kept out of the initial bundle by the
        // generator. Scapey follows the same rule: nothing loads until someone asks.
        const { ask } = await import("./ask");
        await ask({
          question: question.trim(),
          scape,
          history: history.current,
          pinned,
          apiKey,
          modelId,
          webSearch: webSearch && searchAvailability !== "unavailable",
          signal: controller.current.signal,
          onEvent: handleEvent,
        });
      } catch (error) {
        // `ask` reports provider failures through onEvent; this is the last resort for a
        // failure to even start one — a bad dynamic import, say.
        commit({
          kind: "error",
          message: "Scapey could not start",
          detail: error instanceof Error ? error.message : String(error),
        });
        commit({ kind: "done", turn: null });
        setStreaming(false);
      }
    },
    [
      apiKey,
      commit,
      getScape,
      getSelection,
      handleEvent,
      modelId,
      searchAvailability,
      streaming,
      webSearch,
    ],
  );

  const cancel = useCallback(() => {
    controller.current?.abort();
    drainNow();
    commit({ kind: "done", turn: null });
    setStreaming(false);
  }, [commit, drainNow]);

  const clear = useCallback(() => {
    controller.current?.abort();
    queue.current = { text: "", reasoning: "" };
    history.current = [];
    if (storageKey) {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        // Nothing else to clean up.
      }
    }
    setTurns([]);
    setStreaming(false);
  }, []);

  /** Re-asks the last question. The failed turn is replaced, not stacked beneath the retry. */
  const retry = useCallback(() => {
    const last = turns[turns.length - 1];
    if (!last || streaming) return;
    setTurns((prev) => prev.slice(0, -1));
    void send(last.question);
  }, [send, streaming, turns]);

  return {
    turns,
    streaming,
    send,
    cancel,
    clear,
    retry,
    webSearch,
    setWebSearch,
    searchAvailability,
    restored,
    /** Exposed for the dev harness and for tests. Never rendered. */
    historyLength: () => history.current.length,
  };
}

export type { Turn } from "./types";
export { isComplete };
