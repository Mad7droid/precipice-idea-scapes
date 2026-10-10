import { useEffect, useRef, useState } from "react";
import type { ScapiState } from "@/components/scapi/Scapi";
import type { Turn } from "./types";

/** How long the success reaction holds before Scapi settles back to idle. */
export const SUCCESS_HOLD_MS = 1800;

export interface ScapiMood {
  state: ScapiState;
  /** Bumped once per completion this session, so the mascot replays exactly one reaction. */
  reactionKey: number;
}

/**
 * The mascot's state, derived from the conversation's real lifecycle — never from tokens.
 *
 * Only turns this mount watched stream can react. History hydrated after mount, a reopened
 * panel or a restored transcript is already settled, so it must not celebrate or cry again.
 * Every real request renders as streaming before it settles, so nothing live is missed.
 *
 * `busy` covers work that is not a turn (an edit run by the generator): it shows thinking but
 * never a reaction, because an edit's outcome is reported by the ribbon, not by the chat.
 */
export function useScapiMood(turns: Turn[], streaming: boolean, busy = false): ScapiMood {
  const last = turns[turns.length - 1];
  const watched = useRef(new Set<string>());
  const previous = useRef<{ id: string; status: Turn["status"] } | null>(
    last ? { id: last.id, status: last.status } : null,
  );
  const [celebrating, setCelebrating] = useState<string | null>(null);
  const [reactionKey, setReactionKey] = useState(0);

  const id = last?.id;
  const status = last?.status;
  if (id && status === "streaming") watched.current.add(id);

  useEffect(() => {
    const before = previous.current;
    previous.current = id && status ? { id, status } : null;
    if (!id || status !== "done" || !watched.current.has(id)) return;
    // A finished turn reacts once, on its own streaming → done edge.
    if (before?.id !== id || before.status !== "streaming") return;
    setCelebrating(id);
    setReactionKey((key) => key + 1);
    const timer = window.setTimeout(
      () => setCelebrating((current) => (current === id ? null : current)),
      SUCCESS_HOLD_MS,
    );
    return () => window.clearTimeout(timer);
  }, [id, status]);

  let state: ScapiState = "idle";
  if (streaming || busy || status === "streaming") state = "thinking";
  else if (id && celebrating === id && status === "done") state = "success";
  else if (id && status === "error" && watched.current.has(id)) state = "error";
  return { state, reactionKey };
}
