import type { LocalCommand, RouteContext, RouteIntent, RouteSuggestion } from "./types";

/**
 * Zero-latency routing that never leaves the device.
 *
 * Deliberately conservative. Every rule here fires on wording that is close to unambiguous,
 * and anything it is unsure about it leaves alone, so the chips keep the person's last manual
 * choice. Jev, when enabled, is what earns the harder calls. Kept tiny because it sits in the
 * main chunk.
 */

const QUESTION_START =
  /^(what|why|how|which|who|where|when|is|are|does|do|did|can|could|should|would|will|explain|summari[sz]e|compare|tell me|list|kya|kaise|kyun|kaun|kahan)\b/i;
const EDIT_START =
  /^(add|create|make|draw|build|generate|insert|put|write|draft|turn|convert|split|merge|rename|move|replace|rewrite|change|update|expand|extend|fill|sketch|design|mock|simplify|shorten|condense|trim|reduce|remove|delete|drop|cut|clean|tidy|combine|consolidate|restructure|reorgani[sz]e|organi[sz]e|fix|improve|refine|detail|elaborate|bana|banao|jodo|likho)\b/i;
/**
 * Speech softens instructions: "so can you just simplify this?" is an edit, not a question.
 * Stripped before the edit check only, so "can you explain…" still reads as a question.
 */
const SOFTENER =
  /^((so|okay|ok|now|and|right|well|hmm|um|uh)[, ]+)*((can|could|would|will) you |please |just |i want you to |i'd like you to |let'?s |go ahead and )*/i;
const CONNECT =
  /^(connect|link|wire|join)\b(?!.*\b(add|create|new)\b)|\b(draw|add|suggest) (the )?(relationships|connections|links)\b/i;
const SELECTION_WORDS =
  /\b(this|these|that|those|them|it|selected|selection|ye|yeh|isko|inko|isse)\b/i;
const WHOLE_SCAPE = /\b(whole|entire|all of the|everything|scape|canvas|board)\b/i;
const NEEDS_WEB =
  /\b(latest|current|today|this (week|month|year)|news|market|competitor|price|pricing|search( the)? web|look up|research|202\d)\b/i;
const SMALL_EDIT = /^(rename|retitle|fix|tweak|shorten|reword|recolou?r)\b/i;
const LARGE =
  /\b(full|complete|entire|end[- ]to[- ]end|whole (flow|journey|product)|every|all the (screens|steps)|from scratch)\b/i;

const TYPE_WORDS: Record<string, RegExp> = {
  wireframe: /\b(wireframes?|screens?|mock-?ups?|ui|layouts?)\b/i,
  journey: /\b(journeys?|flows?|steps?|user path|funnel)\b/i,
  note: /\b(notes?|stick(y|ies)|ideas?|thoughts?)\b/i,
  scape: /\b(scape blocks?|sub-?scapes?|blocks?)\b/i,
};

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Normalises for matching: lower case, no trailing punctuation or filler. */
function normal(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.!?…,]+$/g, "")
    .replace(/^(please|ok(ay)?|hey scapi|scapi)[, ]+/, "")
    .replace(/\s+please$/, "");
}

/**
 * Finds the object a short phrase names, by title. Exact match first, then a title that
 * contains every word of the phrase. Ambiguity is a non-answer: two equally good candidates
 * mean nothing is focused rather than the wrong thing.
 */
export function matchObject(
  phrase: string,
  objects: RouteContext["objects"],
): RouteContext["objects"][number] | undefined {
  const needle = normal(phrase).replace(/^(the|my|our)\s+/, "");
  if (!needle) return undefined;
  const exact = objects.filter((object) => object.title.trim().toLowerCase() === needle);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  const parts = needle.split(/\s+/);
  const partial = objects.filter((object) => {
    const title = object.title.toLowerCase();
    return parts.every((part) => title.includes(part));
  });
  return partial.length === 1 ? partial[0] : undefined;
}

/** Commands are short, imperative and close to fixed phrases. Anything longer is a request. */
export function heuristicCommand(text: string, context: RouteContext): LocalCommand | undefined {
  if (!context.commands || words(text) > 6) return undefined;
  const phrase = normal(text);
  if (/^(undo|undo (that|it|this|the last (one|change|generation))|go back)$/.test(phrase))
    return { kind: "undo" };
  if (/^(redo|redo (that|it))$/.test(phrase)) return { kind: "redo" };
  if (/^(select all|select everything)$/.test(phrase)) return { kind: "select-all" };
  if (/^(fit|zoom (out|to fit)|show (me )?everything|fit (to )?(the )?(screen|view))$/.test(phrase))
    return { kind: "fit" };
  if (/^(connect|link) (these|them|this|the selection|selected)$/.test(phrase))
    return context.selection.count > 0 ? { kind: "connect" } : undefined;
  const focus = /^(zoom to|go to|jump to|take me to|focus( on)?|show( me)?|find) (.+)$/.exec(
    phrase,
  );
  if (focus) {
    const target = matchObject(focus[focus.length - 1], context.objects);
    if (target) return { kind: "focus", target: target.id };
  }
  return undefined;
}

export function heuristicRoute(text: string, context: RouteContext): RouteSuggestion {
  const phrase = normal(text);
  const suggestion: RouteSuggestion = { source: "heuristic", ms: 0 };
  if (!phrase) return suggestion;

  const command = heuristicCommand(text, context);
  if (command) {
    // A fixed phrase is about as certain as text gets, but every command still needs Enter.
    suggestion.intent = { value: "command", confidence: 0.9 };
    suggestion.command = { value: command, confidence: 0.9 };
    return suggestion;
  }

  let intent: RouteIntent | undefined;
  if (CONNECT.test(phrase)) intent = "connect";
  else if (EDIT_START.test(phrase) || EDIT_START.test(phrase.replace(SOFTENER, "")))
    intent = "edit";
  else if (QUESTION_START.test(phrase) || /\?\s*$/.test(text)) intent = "ask";
  if (intent) {
    suggestion.intent = { value: intent, confidence: 0.75 };
    suggestion.alternative = intent === "ask" ? "edit" : "ask";
  }

  if (context.selection.count > 0) {
    if (WHOLE_SCAPE.test(phrase)) suggestion.scope = { value: "scape", confidence: 0.7 };
    else if (SELECTION_WORDS.test(phrase))
      suggestion.scope = { value: "selection", confidence: 0.75 };
  }

  if (intent === "edit") {
    const offered = context.availableTypes;
    const named = Object.entries(TYPE_WORDS)
      .filter(([type]) => offered.length === 0 || offered.includes(type))
      .filter(([, pattern]) => pattern.test(phrase))
      .map(([type]) => type);
    // One named type is a constraint. Several usually describe the content ("a flow of
    // screens") rather than limit it, so they are left unconstrained.
    if (named.length === 1) suggestion.types = { value: named, confidence: 0.7 };
    if (SMALL_EDIT.test(phrase) && words(phrase) <= 12)
      suggestion.tier = { value: "instant", confidence: 0.7 };
    else if (LARGE.test(phrase) || words(phrase) > 60) suggestion.deep = true;
  }

  // Only ever switches search on. The absence of a keyword is not evidence that a question
  // needs nothing from the web, so turning it off is left to Jev or to the person.
  if (intent === "ask" && NEEDS_WEB.test(phrase)) {
    suggestion.webSearch = { value: true, confidence: 0.75 };
  }

  return suggestion;
}
