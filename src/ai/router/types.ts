import type { ObjectId } from "@/core/types";
import type { Scope } from "@/ai/prompt";
import type { ModelTier } from "@/ai/models";

/**
 * Routing decides *how* a draft is handled before it is sent: whether it is a question or an
 * edit, what it is about, what it may create and which model tier does the work. It never
 * sends, never writes, and never decides anything a person cannot see and change first.
 *
 * See docs/voice-and-routing-plan.md. Where that plan and this code disagree, the plan is
 * stale and should be corrected.
 */

/** `connect` is an edit that may only draw relationships. `command` is a local action. */
export type RouteIntent = "ask" | "edit" | "connect" | "command";

/**
 * Local actions a short draft can name. None deletes, and every one goes through the store or
 * the canvas commands, so each scape change is still a transaction with an undo.
 */
export type LocalCommandKind = "undo" | "redo" | "focus" | "select-all" | "fit" | "connect";

export interface LocalCommand {
  kind: LocalCommandKind;
  /** `focus` only: the object the draft named. */
  target?: ObjectId;
}

/** Commands that move the view or the selection, and change nothing that is saved. */
export const VIEW_COMMANDS: ReadonlySet<LocalCommandKind> = new Set(["focus", "select-all", "fit"]);

/** What a router may know. Titles and types, never bodies, keys, audio or the library. */
export interface RouteContext {
  input: "typed" | "voice";
  selection: { count: number; types: string[] };
  /** Object titles by id, so a command can name its target. Capped by the caller. */
  objects: { id: ObjectId; type: string; title: string }[];
  /** The types this composer may offer. Empty means every registered type. */
  availableTypes: string[];
  /** Whether this composer can run local commands at all. */
  commands: boolean;
}

/** One decided dimension, with how sure the decider was. */
export interface Decided<T> {
  value: T;
  confidence: number;
}

/** Everything a decider may have an opinion on. Absent means "no opinion; keep the manual choice". */
export interface RouteSuggestion {
  intent?: Decided<RouteIntent>;
  /** The runner-up intent, offered as a one-click swap when the decision is unsure. */
  alternative?: RouteIntent;
  scope?: Decided<Scope>;
  types?: Decided<string[]>;
  tier?: Decided<ModelTier>;
  webSearch?: Decided<boolean>;
  command?: Decided<LocalCommand>;
  /** Jev's `depth` was at the top of the rubric: offer Deepen prominently afterwards. */
  deep?: boolean;
  source: "heuristic" | "jev";
  /** Wall time of the deciding request, for the chip's title. Heuristics are 0. */
  ms: number;
}

export type RouteDimension = "intent" | "scope" | "types" | "tier" | "webSearch" | "command";

/** What actually goes out with a send. Built from the manual baseline plus applied suggestions. */
export interface SendRoute {
  intent: Exclude<RouteIntent, "command">;
  scope: Scope;
  types: string[];
  modelId: string;
  webSearch: boolean;
  /** The router thought this was a large or ambiguous request. */
  deep: boolean;
  /** Dimensions the router set, rather than the person. Empty when routing is off. */
  routed: RouteDimension[];
}

/** Confidence bands from the vendor's documented confidence-routing pattern. */
export const APPLY_THRESHOLD = 0.6;
export const CONFIDENT_THRESHOLD = 0.85;
