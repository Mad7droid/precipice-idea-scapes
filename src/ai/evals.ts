import type { Action } from "@/core/actions";
import { emptyScape } from "@/core/fixtures";
import { newScapeId } from "@/core/ids";
import { applyAction } from "@/core/reducer";
import type { Scape } from "@/core/types";
import { generate, type GenerationEvent } from "./generate";
import { projectScape } from "./context";

/**
 * Five prompts with expected shapes.
 *
 * Built early, not late: these are how you find out whether the context projection and the
 * tool schemas are any good while there is still time to change them. A generation that
 * produces twelve disconnected notes is a failure the ribbon will happily render as success.
 */
export interface Eval {
  id: string;
  prompt: string;
  expect: {
    /** Inclusive range for the number of objects created. */
    objects: [number, number];
    /** Types that must appear at least once. */
    requiredTypes: string[];
    minEdges: number;
    /** Fail if the model wastes more than this share of its calls. */
    maxSkipRatio: number;
  };
}

export const EVALS: Eval[] = [
  {
    id: "onboarding",
    prompt: "Design an onboarding flow for a fintech app.",
    expect: {
      objects: [6, 16],
      requiredTypes: ["journey", "wireframe"],
      minEdges: 4,
      maxSkipRatio: 0.25,
    },
  },
  {
    id: "checkout-teardown",
    prompt: "Break down why users abandon a grocery delivery checkout, and what to try.",
    expect: { objects: [5, 16], requiredTypes: ["note"], minEdges: 3, maxSkipRatio: 0.25 },
  },
  {
    id: "settings-screen",
    prompt: "Lay out a settings screen for a team chat app.",
    expect: { objects: [3, 14], requiredTypes: ["wireframe"], minEdges: 1, maxSkipRatio: 0.25 },
  },
  {
    id: "support-journey",
    prompt: "Map the journey of a customer reporting a fraudulent transaction.",
    expect: { objects: [4, 14], requiredTypes: ["journey"], minEdges: 2, maxSkipRatio: 0.25 },
  },
  {
    id: "research-plan",
    prompt: "Plan a week of user research for a new expense-reporting tool.",
    expect: { objects: [4, 14], requiredTypes: ["note"], minEdges: 2, maxSkipRatio: 0.25 },
  },
];

export interface EvalResult {
  id: string;
  passed: boolean;
  failures: string[];
  objects: number;
  edges: number;
  types: string[];
  applied: number;
  skipped: number;
  promptTokens: number;
  ms: number;
}

export interface RunEvalsOptions {
  apiKey: string;
  modelId: string;
  only?: string[];
  onResult?: (result: EvalResult) => void;
  signal?: AbortSignal;
}

/**
 * Each eval runs against its own throwaway Scape held in a local variable — never the store,
 * so running the suite cannot touch whatever the user has open.
 */
export async function runEvals(options: RunEvalsOptions): Promise<EvalResult[]> {
  const chosen = options.only?.length ? EVALS.filter((e) => options.only!.includes(e.id)) : EVALS;

  const results: EvalResult[] = [];

  for (const item of chosen) {
    if (options.signal?.aborted) break;

    let scape: Scape = emptyScape(newScapeId(), "Eval");
    const started = Date.now();

    const dispatch = (action: Action): boolean => {
      const result = applyAction(scape, action);
      if (!result.inverse) return false;
      scape = result.state;
      return true;
    };

    const outcome = await generate({
      request: item.prompt,
      scape,
      apiKey: options.apiKey,
      modelId: options.modelId,
      dispatch,
      onEvent: () => {},
      ...(options.signal ? { signal: options.signal } : {}),
    });

    const types = [...new Set(Object.values(scape.objects).map((o) => o.type))].sort();
    const objects = scape.objectOrder.length;
    const edges = Object.keys(scape.relationships).length;
    const total = outcome.applied + outcome.skipped;

    const failures: string[] = [];
    if (objects < item.expect.objects[0] || objects > item.expect.objects[1]) {
      failures.push(
        `${objects} objects, expected ${item.expect.objects[0]}–${item.expect.objects[1]}`,
      );
    }
    for (const required of item.expect.requiredTypes) {
      if (!types.includes(required)) failures.push(`no ${required}`);
    }
    if (edges < item.expect.minEdges) {
      failures.push(`${edges} edges, expected at least ${item.expect.minEdges}`);
    }
    if (total > 0 && outcome.skipped / total > item.expect.maxSkipRatio) {
      failures.push(`${outcome.skipped}/${total} calls skipped`);
    }

    const result: EvalResult = {
      id: item.id,
      passed: failures.length === 0,
      failures,
      objects,
      edges,
      types,
      applied: outcome.applied,
      skipped: outcome.skipped,
      promptTokens: projectScape(scape).estimatedTokens,
      ms: Date.now() - started,
    };

    results.push(result);
    options.onResult?.(result);
  }

  return results;
}

/** A pass/fail table. Fixed-width so it lines up in a terminal or a mono block. */
export function formatEvalTable(results: EvalResult[]): string {
  const pad = (value: string | number, width: number) => String(value).padEnd(width);
  const header = `${pad("eval", 20)}${pad("", 5)}${pad("objs", 6)}${pad("edges", 7)}${pad("applied", 9)}${pad("skipped", 9)}${pad("ms", 7)}notes`;

  const rows = results.map((r) => {
    const notes = r.passed ? r.types.join(", ") : r.failures.join("; ");
    return (
      pad(r.id, 20) +
      pad(r.passed ? "pass" : "FAIL", 5) +
      pad(r.objects, 6) +
      pad(r.edges, 7) +
      pad(r.applied, 9) +
      pad(r.skipped, 9) +
      pad(r.ms, 7) +
      notes
    );
  });

  const passed = results.filter((r) => r.passed).length;
  return [
    header,
    "-".repeat(header.length),
    ...rows,
    "",
    `${passed}/${results.length} passed`,
  ].join("\n");
}

export type { GenerationEvent };
