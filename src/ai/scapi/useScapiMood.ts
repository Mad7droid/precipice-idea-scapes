import { useEffect, useRef, useState } from "react";
import type { ScapiState } from "@/components/scapi/Scapi";
import type { Turn } from "./types";

/** How long the success reaction holds before Scapi settles back to idle. */
export const SUCCESS_HOLD_MS = 1800;
/**
 * A failure is acknowledged, not dwelt on. The error card stays; the worried face does not,
 * so a failed turn never leaves a warning mascot parked under it.
 */
export const ERROR_HOLD_MS = 2400;

export interface ScapiMood {
  state: ScapiState;
  /** Bumped once per settled turn this session, so the mascot replays exactly one reaction. */
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
  const [reacting, setReacting] = useState<{ id: string; status: "done" | "error" } | null>(null);
  const [reactionKey, setReactionKey] = useState(0);

  const id = last?.id;
  const status = last?.status;
  if (id && status === "streaming") watched.current.add(id);

  useEffect(() => {
    const before = previous.current;
    previous.current = id && status ? { id, status } : null;
    if (!id || (status !== "done" && status !== "error") || !watched.current.has(id)) return;
    // A settled turn reacts once, on its own streaming → done/error edge.
    if (before?.id !== id || before.status !== "streaming") return;
    const reaction = { id, status };
    setReacting(reaction);
    setReactionKey((key) => key + 1);
    const timer = window.setTimeout(
      () => setReacting((current) => (current === reaction ? null : current)),
      status === "done" ? SUCCESS_HOLD_MS : ERROR_HOLD_MS,
    );
    return () => window.clearTimeout(timer);
  }, [id, status]);

  let state: ScapiState = "idle";
  if (streaming || busy || status === "streaming") state = "thinking";
  else if (id && reacting?.id === id && reacting.status === status) {
    state = status === "done" ? "success" : "error";
  }
  return { state, reactionKey };
}
