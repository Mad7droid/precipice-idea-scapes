import { modelForTier } from "@/ai/models";
import type { Scope } from "@/ai/prompt";
import {
  APPLY_THRESHOLD,
  CONFIDENT_THRESHOLD,
  type Decided,
  type LocalCommand,
  type RouteDimension,
  type RouteIntent,
  type RouteSuggestion,
  type SendRoute,
} from "./types";

/** The person's own choices: what every control shows when routing has nothing to add. */
export interface RouteBaseline {
  intent: "ask" | "edit";
  scope: Scope;
  types: string[];
  modelId: string;
  webSearch: boolean;
  selectionCount: number;
}

export interface Decision {
  route: SendRoute;
  /** A recognised local command, shown instead of a send. Always needs Enter. */
  command?: LocalCommand;
  /** The intent was applied, but only in the 0.6–0.85 band: offer the runner-up. */
  alternative?: Exclude<RouteIntent, "command">;
  source?: RouteSuggestion["source"];
  ms: number;
}

/**
 * Picks, per dimension, the more confident of two suggestions. Jev wins ties because it read
 * the whole sentence; the heuristics only ever matched a phrase.
 */
export function merge(heuristic: RouteSuggestion, jev: RouteSuggestion | null): RouteSuggestion {
  if (!jev) return heuristic;
  const pick = <T>(a?: Decided<T>, b?: Decided<T>) =>
    !a ? b : !b ? a : b.confidence >= a.confidence ? b : a;
  const intent = pick(heuristic.intent, jev.intent);
  const merged: RouteSuggestion = {
    source: "jev",
    ms: jev.ms,
    deep: jev.deep ?? heuristic.deep ?? false,
  };
  const set = <K extends keyof RouteSuggestion>(key: K, value: RouteSuggestion[K] | undefined) => {
    if (value !== undefined) merged[key] = value;
  };
  set("intent", intent);
  set("alternative", intent === jev.intent ? jev.alternative : heuristic.alternative);
  set("scope", pick(heuristic.scope, jev.scope));
  set("types", pick(heuristic.types, jev.types));
  set("tier", pick(heuristic.tier, jev.tier));
  set("webSearch", pick(heuristic.webSearch, jev.webSearch));
  set("command", pick(heuristic.command, jev.command));
  return merged;
}

/**
 * The route a send would use right now.
 *
 * Pure, so every invariant in docs/voice-and-routing-plan.md is a table test rather than a hope:
 * a locked dimension is never touched, nothing below 0.6 is applied, web search never rides
 * along with write tools, and routing never moves someone off a model tier they chose except
 * down to the instant tier for a tweak.
 */
export function decide(
  baseline: RouteBaseline,
  suggestion: RouteSuggestion | null,
  locked: ReadonlySet<RouteDimension>,
): Decision {
  const routed: RouteDimension[] = [];
  const usable = <T>(dimension: RouteDimension, decided?: Decided<T>): decided is Decided<T> =>
    !!decided && !locked.has(dimension) && decided.confidence >= APPLY_THRESHOLD;

  let intent: SendRoute["intent"] = baseline.intent;
  let alternative: Decision["alternative"];
  let command: LocalCommand | undefined;

  if (suggestion && usable("intent", suggestion.intent)) {
    const value = suggestion.intent.value;
    if (value === "command") {
      if (usable("command", suggestion.command)) command = suggestion.command.value;
    } else {
      intent = value;
      if (intent !== baseline.intent) routed.push("intent");
      if (suggestion.intent.confidence < CONFIDENT_THRESHOLD && suggestion.alternative) {
        const runnerUp = suggestion.alternative;
        if (runnerUp !== "command" && runnerUp !== intent) alternative = runnerUp;
      }
    }
  }

  let scope = baseline.scope;
  if (suggestion && usable("scope", suggestion.scope) && suggestion.scope.value !== scope) {
    scope = suggestion.scope.value;
    routed.push("scope");
  }
  // A selection scope with nothing selected cannot mean anything narrower than the scape.
  if (baseline.selectionCount === 0) scope = "scape";

  const writes = intent === "edit" || intent === "connect";

  let types = baseline.types;
  if (writes && intent === "edit" && suggestion && usable("types", suggestion.types)) {
    types = suggestion.types.value;
    routed.push("types");
  }

  let modelId = baseline.modelId;
  if (suggestion && usable("tier", suggestion.tier) && suggestion.tier.value === "instant") {
    const next = modelForTier("instant", baseline.modelId);
    if (next !== modelId) {
      modelId = next;
      routed.push("tier");
    }
  }

  let webSearch = baseline.webSearch;
  if (
    intent === "ask" &&
    suggestion &&
    usable("webSearch", suggestion.webSearch) &&
    suggestion.webSearch.value !== webSearch
  ) {
    webSearch = suggestion.webSearch.value;
    routed.push("webSearch");
  }

  return {
    route: {
      intent,
      scope,
      types,
      modelId,
      // The capability boundary: a request that can write never also reads the open web.
      webSearch: writes ? false : webSearch,
      deep: writes && !!suggestion?.deep,
      routed: command ? [] : routed,
    },
    ...(command ? { command } : {}),
    ...(alternative ? { alternative } : {}),
    ...(suggestion ? { source: suggestion.source } : {}),
    ms: suggestion?.ms ?? 0,
  };
}
