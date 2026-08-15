import { useCallback, useEffect, useRef, useState } from "react";
import type { ObjectId, Scape } from "@/core/types";
import { applyAskEvent, isComplete, startTurn } from "./reducer";
import type { AskEvent, ModelTurn, SearchAvailability, Turn } from "./types";

/**
 * Scapi's state for one scape.
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
 * Provider chunks are not human-sized. Re-rendering each one makes Markdown jump, but holding
 * the entire answer until completion makes a capable assistant look idle. We coalesce deltas to
 * a calm, bounded cadence and keep only ambiguous Markdown syntax off-screen, so stable prose
 * appears promptly without turning into a character-by-character typewriter.
 */

export interface UseScapiOptions {
  /** Read at send time rather than captured, so a question always sees the current canvas. */
  getScape: () => Scape | null;
  /** Objects selected on the canvas right now. */
  getSelection?: () => ObjectId[];
  apiKey: string;
  modelId: string;
  scapeId?: string;
}

const MIN_PAINT_INTERVAL_MS = 80;
const MAX_BUFFERED_CHARS = 160;

function isSemanticBoundary(text: string): boolean {
  return /(?:[.!?…](?:\s|$)|\n\n)$/.test(text);
}

/**
 * Keep a trailing Markdown construct out of ReactMarkdown until it is complete.
 *
 * This intentionally covers the constructs most likely to arrive across provider chunks rather
 * than attempting to reimplement CommonMark. The server is still the source of truth; this is a
 * small presentation buffer that prevents visibly broken links and code blocks mid-stream.
 */
export function splitStableMarkdown(markdown: string): { stable: string; pending: string } {
  let boundary = markdown.length;

  const lastFence = markdown.lastIndexOf("```");
  if (lastFence !== -1 && (markdown.match(/```/g)?.length ?? 0) % 2 === 1) boundary = lastFence;

  const lastTick = markdown.lastIndexOf("`");
  if (
    lastTick !== -1 &&
    lastTick !== lastFence &&
    (markdown.match(/(?<!`)`(?!`)/g)?.length ?? 0) % 2 === 1
  )
    boundary = Math.min(boundary, lastTick);

  const openLink = markdown.lastIndexOf("[");
  if (openLink > markdown.lastIndexOf("]")) boundary = Math.min(boundary, openLink);

  // A pipe table is visually noisy until its terminating blank line. Keep its complete run
  // atomic, rather than briefly showing raw pipes while rows are still arriving.
  const table = /(?:^|\n)(\|[^\n]*\|(?:\n\|[^\n]*)*)$/.exec(markdown);
  if (table?.index !== undefined) {
    const tableStart = table.index + (table[0].startsWith("\n") ? 1 : 0);
    boundary = Math.min(boundary, tableStart);
  }

  // `[label](` is no longer caught by the unmatched-bracket check above, but still cannot be
  // rendered as a link until its destination closes. Keep the whole construct together.
  const linkDestination = markdown.lastIndexOf("](");
  if (linkDestination !== -1 && linkDestination > markdown.lastIndexOf(")")) {
    const linkStart = markdown.lastIndexOf("[", linkDestination);
    if (linkStart !== -1) boundary = Math.min(boundary, linkStart);
  }

  const strong = markdown.lastIndexOf("**");
  if (strong !== -1 && (markdown.match(/\*\*/g)?.length ?? 0) % 2 === 1)
    boundary = Math.min(boundary, strong);

  // Single emphasis markers are only considered Markdown at the start of a word. This avoids
  // treating ordinary identifiers such as `object_id` as markup while still holding `*draft`.
  const emphasis = [...markdown.matchAll(/(?:^|\s)([*_])(?=\S)/gm)];
  if (emphasis.length % 2 === 1) {
    const match = emphasis[emphasis.length - 1];
    const marker = match.index! + match[0].length - 1;
    boundary = Math.min(boundary, marker);
  }

  // A single Markdown marker at the tail is ambiguous until the next token arrives.
  if (/[*_`\[]$/.test(markdown)) boundary = Math.min(boundary, markdown.length - 1);

  return { stable: markdown.slice(0, boundary), pending: markdown.slice(boundary) };
}

export function useScapi({ getScape, getSelection, apiKey, modelId, scapeId }: UseScapiOptions) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [webSearch, setWebSearch] = useState(true);
  const [searchAvailability, setSearchAvailability] = useState<SearchAvailability>("unknown");
  const [restored, setRestored] = useState(false);

  const history = useRef<ModelTurn[]>([]);
  const controller = useRef<AbortController | null>(null);
  const streamTiming = useRef({ startedAt: 0, lastEventAt: 0 });

  const queue = useRef({ text: "", reasoning: "", lastPaintAt: 0 });
  const animationFrame = useRef<number | null>(null);
  const paintTimer = useRef<number | null>(null);
  /** Prevent the initial empty render from overwriting a transcript before it has been read. */
  const storageHydrated = useRef(false);

  const storageKey = scapeId ? `precipice.scapi.${scapeId}` : null;
  const legacyStorageKey = scapeId ? `precipice.scapey.${scapeId}` : null;

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
      let saved = sessionStorage.getItem(storageKey);
      if (!saved && legacyStorageKey) {
        const legacy = sessionStorage.getItem(legacyStorageKey);
        if (legacy) {
          // Only remove the old name after the new value has been safely written.
          sessionStorage.setItem(storageKey, legacy);
          sessionStorage.removeItem(legacyStorageKey);
          saved = legacy;
        }
      }
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
  }, [legacyStorageKey, storageKey]);

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

  /** Paint all accumulated Markdown, including a currently incomplete tail. */
  const drainNow = useCallback(() => {
    const { text, reasoning } = queue.current;
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
    if (paintTimer.current !== null) window.clearTimeout(paintTimer.current);
    animationFrame.current = null;
    paintTimer.current = null;
    queue.current = { text: "", reasoning: "", lastPaintAt: performance.now() };
    if (reasoning)
      updateLast((turn) => applyAskEvent(turn, { kind: "reasoning", text: reasoning }));
    if (text) updateLast((turn) => applyAskEvent(turn, { kind: "text", text }));
  }, [updateLast]);

  /** Paint meaningful chunks promptly, but cap updates so text never feels like a typewriter. */
  const drainStable = useCallback(() => {
    animationFrame.current = null;
    const { stable, pending } = splitStableMarkdown(queue.current.text);
    const reasoning = queue.current.reasoning;
    const elapsed = performance.now() - queue.current.lastPaintAt;
    if (
      stable &&
      !isSemanticBoundary(stable) &&
      stable.length < MAX_BUFFERED_CHARS &&
      elapsed < MIN_PAINT_INTERVAL_MS
    ) {
      paintTimer.current = window.setTimeout(() => {
        paintTimer.current = null;
        scheduleDrainRef.current();
      }, MIN_PAINT_INTERVAL_MS - elapsed);
      return;
    }
    queue.current = { text: pending, reasoning: "", lastPaintAt: performance.now() };
    if (reasoning)
      updateLast((turn) => applyAskEvent(turn, { kind: "reasoning", text: reasoning }));
    if (stable) updateLast((turn) => applyAskEvent(turn, { kind: "text", text: stable }));
  }, [updateLast]);

  const scheduleDrainRef = useRef<() => void>(() => {});

  const scheduleDrain = useCallback(() => {
    if (animationFrame.current !== null || paintTimer.current !== null) return;
    animationFrame.current = requestAnimationFrame(drainStable);
  }, [drainStable]);
  scheduleDrainRef.current = scheduleDrain;

  useEffect(
    () => () => {
      controller.current?.abort();
      if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
      if (paintTimer.current !== null) window.clearTimeout(paintTimer.current);
    },
    [],
  );

  const handleEvent = useCallback(
    (event: AskEvent) => {
      if (import.meta.env.DEV && window.location.pathname.startsWith("/dev/")) {
        const now = performance.now();
        console.debug("[Scapi stream]", event.kind, {
          sinceStartMs: Math.round(now - streamTiming.current.startedAt),
          sincePreviousEventMs: Math.round(now - streamTiming.current.lastEventAt),
        });
        streamTiming.current.lastEventAt = now;
      }
      switch (event.kind) {
        case "text":
          queue.current.text += event.text;
          scheduleDrain();
          return;

        case "reasoning":
          queue.current.reasoning += event.text;
          scheduleDrain();
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
    [commit, drainNow, scheduleDrain],
  );

  const send = useCallback(
    async (question: string) => {
      const scape = getScape();
      if (!scape || !question.trim() || streaming) return;

      const pinned = getSelection?.() ?? [];
      controller.current?.abort();
      controller.current = new AbortController();

      queue.current = { text: "", reasoning: "", lastPaintAt: performance.now() };
      streamTiming.current = { startedAt: performance.now(), lastEventAt: performance.now() };
      setTurns((prev) => [...prev, startTurn(question.trim(), pinned)]);
      setStreaming(true);

      try {
        // The provider SDK is large and is already kept out of the initial bundle by the
        // generator. Scapi follows the same rule: nothing loads until someone asks.
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
          message: "Scapi could not start",
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
    queue.current = { text: "", reasoning: "", lastPaintAt: performance.now() };
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
