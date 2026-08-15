import type { ObjectId } from "@/core/types";
import type { AskEvent, Turn } from "./types";

/**
 * The stream state machine, as a pure function.
 *
 * Kept out of the hook so every row of it can be tested without React, a network, or a fake
 * timer. The hook's only extra job is batching deltas to one frame — it does that by summing
 * text and handing this a single larger event, so there is no second code path.
 */

/**
 * Turn ids are React keys and local lookup handles — never persisted, never shown, never sent
 * anywhere. A counter is enough, and it keeps tests deterministic. `src/core/ids.ts` is frozen
 * and has no generic helper to borrow.
 */
let sequence = 0;

export function startTurn(question: string, pinned: ObjectId[] = []): Turn {
  return {
    id: `turn_${++sequence}`,
    question,
    pinned,
    reasoning: "",
    body: "",
    activity: [],
    sources: [],
    status: "streaming",
    error: null,
  };
}

export function applyAskEvent(turn: Turn, event: AskEvent): Turn {
  switch (event.kind) {
    case "reasoning":
      return { ...turn, reasoning: turn.reasoning + event.text };

    case "text":
      return { ...turn, body: turn.body + event.text };

    case "activity":
      return { ...turn, activity: [...turn.activity, event.event] };

    case "source":
      // The same source can arrive more than once across steps; the block is a set, not a log.
      return turn.sources.some((s) => s.id === event.source.id)
        ? turn
        : { ...turn, sources: [...turn.sources, event.source] };

    // Availability is panel-level state. It does not belong in the display transcript.
    case "search-unavailable":
    case "history-reset":
      return turn;

    case "error":
      return {
        ...turn,
        status: "error",
        error: { message: event.message, detail: event.detail },
      };

    case "done":
      // An error already decided this turn's fate. `done` always follows one, and must not
      // overwrite the status that explains what the user is looking at.
      if (turn.status === "error") return turn;
      // No recorded turn and no error means the user stopped it. Whatever streamed stays on
      // screen — it was real output, and throwing it away on cancel is its own small betrayal.
      return { ...turn, status: event.turn ? "done" : "cancelled" };
  }
}

/** Whether this turn is safe to keep in the model's history. Only complete ones are. */
export function isComplete(turn: Turn): boolean {
  return turn.status === "done";
}
