import type { ModelMessage } from "ai";
import type { ObjectId } from "@/core/types";

/**
 * Scapi's two representations of a conversation, and why they are not one.
 *
 * The **display transcript** (`Turn`) is what we render and what survives a reload. The
 * **model context** (`ModelTurn`) is what the provider needs back, verbatim, to stay coherent.
 * Conflating them breaks two different things in two different ways, so they are separate types
 * that are never derived from each other.
 */

export type TurnStatus = "streaming" | "done" | "cancelled" | "error";

/**
 * One question and its answer, as the user sees it.
 *
 * Everything here is display state. Nothing in this type is ever sent to the model — the model
 * gets `ModelTurn`, which carries provider-shaped messages this cannot reconstruct.
 */
export interface Turn {
  id: string;
  question: string;
  /** Objects the user pinned for this question — selection, and later `@` mentions. */
  pinned: ObjectId[];
  /** Summarised thinking, streamed. Empty when the model chose not to think. */
  reasoning: string;
  /** Markdown, streamed. */
  body: string;
  activity: ActivityEvent[];
  sources: Source[];
  status: TurnStatus;
  error: { message: string; detail: string } | null;
}

export type SearchAvailability = "unknown" | "available" | "unavailable";

/**
 * What Scapi is doing right now, as a list rather than a single value.
 *
 * Kept after the turn finishes and collapsed to a summary line, because "it searched twice and
 * read four objects" is exactly the provenance a user wants when deciding whether to believe an
 * answer.
 */
export type ActivityEvent =
  /** Emitted before the request leaves: the whole scape has just been read and projected. */
  | { kind: "reading-scape"; objects: number }
  | { kind: "thinking" }
  | { kind: "reading-canvas"; query: string }
  | { kind: "reading-objects"; ids: ObjectId[] }
  | { kind: "searching"; query: string }
  | { kind: "read-sources"; count: number }
  | { kind: "writing" };

export interface Source {
  id: string;
  url: string;
  title: string;
}

/**
 * One exchange as the *provider* needs it back.
 *
 * `response` is `result.response.messages`, which is typed
 * `Array<AssistantModelMessage | ToolModelMessage>` — it contains only what the model generated
 * and **never the user's question**. Appending it alone builds a history of answers with no
 * questions: by the second turn the model cannot answer "what did I just ask?", and every
 * follow-up that leans on the earlier question drifts without any visible failure.
 *
 * So the pair is stored together and is indivisible. Two invariants follow, both tested:
 *
 * 1. `response` is kept **verbatim**, including the opaque `encryptedContent` on every
 *    `web_search_result`. That field is what lets the model keep citing sources it already
 *    found; stripping it to save bytes silently degrades every later turn in a research thread.
 * 2. Only *complete* turns are recorded. A cancelled or errored turn is discarded whole — a
 *    `user` with no `response` leaves a dangling question, and a `response` with no `user` is
 *    the bug this type exists to prevent.
 */
export interface ModelTurn {
  user: ModelMessage;
  response: ModelMessage[];
}

/** Events the stream reducer consumes. One per meaningful thing the provider told us. */
export type AskEvent =
  | { kind: "reasoning"; text: string }
  | { kind: "text"; text: string }
  | { kind: "activity"; event: ActivityEvent }
  | { kind: "source"; source: Source }
  | { kind: "search-unavailable" }
  | { kind: "error"; message: string; detail: string }
  /** The turn completed and may be recorded. Absent `turn` means nothing is safe to keep. */
  | { kind: "done"; turn: ModelTurn | null };
