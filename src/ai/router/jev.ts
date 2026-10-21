import { z } from "zod";
import { isDesktop } from "@/desktop/runtime";
import { allPlugins } from "@/core/registry";
import type { LocalCommandKind, RouteContext, RouteIntent, RouteSuggestion } from "./types";

/**
 * TypeSafe Jev, a "System One" decision model, asked every routing question in one request.
 *
 * Imported dynamically, and only once someone has opted in with their own key, so neither this
 * module nor its schema reaches the main chunk. Plain `fetch` rather than the vendor SDK: the
 * SDK targets Node, and the API is one POST.
 *
 * What is sent is the draft and the content-light context in `RouteContext` — types, counts
 * and titles. Never object bodies, audio, keys or anything from the library.
 */

export const JEV_MODEL = "jev-latest";
const DIRECT_URL = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_PROXY_ORIGIN = "https://precipice-ai-proxy.precipice.workers.dev";
/** Past this, routing gives up and the heuristics stand. Sending never waits on it. */
export const JEV_TIMEOUT_MS = 800;
/** Titles offered as command targets. Beyond this the choice gets slow and order-biased. */
const MAX_TARGETS = 60;
const MAX_COMMAND_WORDS = 8;

export function jevUrl(): string {
  if (isDesktop()) return DIRECT_URL;
  const origin = import.meta.env.VITE_AI_PROXY_URL ?? DEFAULT_PROXY_ORIGIN;
  return `${origin.replace(/\/+$/, "")}/v1/systemone`;
}

// The order of each option list is deliberate: Jev leans toward earlier options, so the most
// common answer goes first and a wrong lean costs the least.
const INTENTS: Record<RouteIntent, string> = {
  edit: "Change the canvas: create, rewrite, expand or restructure objects such as notes, journeys and wireframes.",
  ask: "A question or a request for analysis, explanation or a summary. Nothing on the canvas should change.",
  connect:
    "Only draw relationships between objects that already exist. Nothing new is created and no content changes.",
  command:
    "A short instruction to the app itself, such as undo, redo, zoom to an object, fit the view or select everything.",
};

const COMMANDS: Record<LocalCommandKind | "none", string> = {
  none: "Not one of the app commands below.",
  undo: "Undo the last change.",
  redo: "Redo the change that was just undone.",
  focus: "Zoom to, go to, show or find one named object.",
  "select-all": "Select every object.",
  fit: "Zoom out or fit the whole canvas in view.",
  connect: "Connect the selected objects.",
};

const DEPTH = [
  "A tweak to one existing thing: a rename, a reword, a colour.",
  "One new object, or a small change to a few.",
  "A standard flow or set of several related objects.",
  "A large, multi-part or ambiguous brief that needs careful planning.",
];

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function buildRequest(text: string, context: RouteContext) {
  const offered = allPlugins().filter(
    (plugin) => context.availableTypes.length === 0 || context.availableTypes.includes(plugin.type),
  );
  const commandCandidate = context.commands && wordCount(text) <= MAX_COMMAND_WORDS;
  const targets = commandCandidate ? context.objects.slice(0, MAX_TARGETS) : [];

  const questions: Record<string, unknown> = {
    intent: {
      type: "choice",
      instructions: "How should a visual canvas assistant handle this request?",
      criteria: commandCandidate
        ? INTENTS
        : Object.fromEntries(Object.entries(INTENTS).filter(([key]) => key !== "command")),
    },
    depth: {
      type: "score",
      instructions: "How much work does this request need, if it changes the canvas?",
      criteria: DEPTH,
    },
    web: {
      type: "noul",
      instructions:
        "Answering this needs current information from outside the canvas, such as the web.",
    },
    ...Object.fromEntries(
      offered.map((plugin) => [
        `type_${plugin.type}`,
        {
          type: "noul",
          instructions: `The request explicitly asks for ${plugin.label.toLowerCase()} objects to be created.`,
        },
      ]),
    ),
  };
  if (context.selection.count > 0) {
    questions.about_selection = {
      type: "noul",
      instructions:
        "The request is about the objects the person has selected, rather than the whole canvas.",
    };
  }
  if (commandCandidate) {
    questions.command = {
      type: "choice",
      instructions: "Which app command, if any, does this short instruction name?",
      criteria: COMMANDS,
    };
  }
  if (targets.length > 0) {
    questions.target = {
      type: "choice",
      instructions: "Which object does the request name? Answer none if it names no object.",
      criteria: {
        none: "No object is named.",
        ...Object.fromEntries(targets.map((object) => [object.id, object.title || object.type])),
      },
    };
  }

  return {
    model: JEV_MODEL,
    state: {
      request: text.trim(),
      input: context.input,
      selection: context.selection,
      object_types: offered.map((plugin) => plugin.type),
    },
    questions,
  };
}

const choiceAnswer = z.object({
  choice: z.string(),
  confidence: z.number().finite().min(0).max(1).nullish(),
});
const noulAnswer = z.object({ noul: z.number().finite().min(0).max(1) });
const scoreAnswer = z.object({
  score: z.number().finite().min(0).max(3),
  confidence: z.number().finite().min(0).max(1).nullish(),
});
const response = z.object({ answers: z.record(z.string(), z.unknown()) });

/** Typed answers become a suggestion. Anything malformed is dropped, never guessed at. */
export function parseAnswers(
  raw: unknown,
  context: RouteContext,
  ms: number,
): RouteSuggestion | null {
  const parsed = response.safeParse(raw);
  if (!parsed.success) return null;
  const answers = parsed.data.answers;
  const choice = (key: string) => {
    const result = choiceAnswer.safeParse(answers[key]);
    return result.success ? result.data : undefined;
  };
  const noul = (key: string) => {
    const result = noulAnswer.safeParse(answers[key]);
    return result.success ? Math.min(1, Math.max(0, result.data.noul)) : undefined;
  };
  const suggestion: RouteSuggestion = { source: "jev", ms };

  const intent = choice("intent");
  if (intent && Object.hasOwn(INTENTS, intent.choice)) {
    suggestion.intent = { value: intent.choice as RouteIntent, confidence: intent.confidence ?? 0 };
    const probabilities = (answers.intent as { probabilities?: Record<string, number> })
      .probabilities;
    if (probabilities) {
      const runnerUp = Object.entries(probabilities)
        .filter(
          ([key]) => key !== intent.choice && Object.hasOwn(INTENTS, key) && key !== "command",
        )
        .sort((a, b) => b[1] - a[1])[0];
      if (runnerUp) suggestion.alternative = runnerUp[0] as RouteIntent;
    }
  }

  const command = choice("command");
  const target = choice("target");
  if (
    context.commands &&
    command &&
    command.choice !== "none" &&
    Object.hasOwn(COMMANDS, command.choice)
  ) {
    const kind = command.choice as LocalCommandKind;
    const named =
      target && target.choice !== "none" && context.objects.some((o) => o.id === target.choice)
        ? target.choice
        : undefined;
    // A focus with no confidently named target is not a command anyone can run.
    if (kind !== "focus" || (named && (target?.confidence ?? 0) >= 0.6)) {
      const confidence = Math.min(
        command.confidence ?? 0,
        suggestion.intent?.confidence ?? 0,
        kind === "focus" ? (target?.confidence ?? 0) : 1,
      );
      suggestion.command = {
        value: kind === "focus" ? { kind, target: named! } : { kind },
        confidence,
      };
    }
  }

  const about = noul("about_selection");
  if (about !== undefined && context.selection.count > 0) {
    suggestion.scope = {
      value: about >= 0.5 ? "selection" : "scape",
      confidence: Math.max(about, 1 - about),
    };
  }

  const wanted = Object.keys(answers)
    .filter((key) => key.startsWith("type_"))
    .map((key) => [key.slice(5), noul(key)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== undefined);
  const offered = allPlugins()
    .map((plugin) => plugin.type)
    .filter((type) => context.availableTypes.length === 0 || context.availableTypes.includes(type));
  const named = wanted
    .filter(([type, p]) => p >= 0.8 && offered.includes(type))
    .map(([type]) => type);
  if (named.length > 0 && named.length < wanted.length) {
    suggestion.types = {
      value: named,
      confidence: Math.min(...wanted.map(([, p]) => Math.max(p, 1 - p))),
    };
  }

  const depth = scoreAnswer.safeParse(answers.depth);
  if (depth.success) {
    const confidence = depth.data.confidence ?? 0;
    if (depth.data.score < 0.75) suggestion.tier = { value: "instant", confidence };
    else suggestion.tier = { value: "standard", confidence };
    suggestion.deep = depth.data.score >= 2.5 && confidence >= 0.6;
  }

  const web = noul("web");
  if (web !== undefined) {
    suggestion.webSearch = { value: web >= 0.5, confidence: Math.max(web, 1 - web) };
  }

  return suggestion;
}

/**
 * One routing request. Resolves to null on any failure — timeout, offline, bad key, a schema
 * the vendor changed — because a missing route is always safe and an error is never shown.
 */
export async function askJev(
  text: string,
  context: RouteContext,
  apiKey: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<RouteSuggestion | null> {
  if (!apiKey.trim() || signal?.aborted) return null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, JEV_TIMEOUT_MS);
  const started = performance.now();
  try {
    const result = await fetcher(jevUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify(buildRequest(text, context)),
      signal: controller.signal,
    });
    if (!result.ok) return null;
    return parseAnswers(await result.json(), context, Math.round(performance.now() - started));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
