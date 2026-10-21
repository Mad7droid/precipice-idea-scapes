import type { RouteContext, RouteIntent, RouteSuggestion } from "./types";

/** Synthetic text scenarios, not speech-recognition or real-user acceptance evidence. */
const subjects = ["checkout", "onboarding", "pricing", "account settings"];
const templates: [RouteIntent, string][] = [
  ["ask", "What is missing from the SUBJECT flow?"],
  ["ask", "How could SUBJECT be simpler?"],
  ["ask", "Compare these SUBJECT screens"],
  ["ask", "Explain the SUBJECT journey"],
  ["ask", "Summarize the SUBJECT notes"],
  ["ask", "Research current SUBJECT patterns"],
  ["ask", "Kya SUBJECT flow sahi hai?"],
  ["ask", "Kaise SUBJECT ko improve kar sakte hain?"],
  ["ask", "Could you explain SUBJECT without changing anything?"],
  ["ask", "Do not edit anything; what is wrong with SUBJECT?"],
  ["edit", "Add a SUBJECT wireframe"],
  ["edit", "Create a complete SUBJECT journey"],
  ["edit", "Rewrite this SUBJECT note to be shorter"],
  ["edit", "Rename the selected note to SUBJECT"],
  ["edit", "Build three SUBJECT screens and connect them"],
  ["edit", "Banao ek SUBJECT wireframe"],
  ["edit", "SUBJECT ke liye ek note bana do"],
  ["edit", "Please add a SUBJECT note"],
  ["edit", "Can you add a SUBJECT screen to the canvas?"],
  ["edit", "Update these SUBJECT objects, keeping their links"],
  ["connect", "Connect the existing SUBJECT objects"],
  ["connect", "Only draw relationships between the SUBJECT objects"],
  ["connect", "Link the SUBJECT journey to the existing note"],
  ["command", "Zoom to SUBJECT"],
  ["command", "Focus on SUBJECT"],
];

export const ROUTING_EVALS = templates.flatMap(([intent, template], index) =>
  subjects.map((subject, variant) => ({
    id: `route-${index + 1}-${variant + 1}`,
    text: template.replaceAll("SUBJECT", subject),
    intent,
    context: {
      input: variant % 2 ? "voice" : "typed",
      selection: { count: 2, types: ["note", "wireframe"] },
      objects: subjects.map((title, i) => ({ id: `eval-${i}`, type: "note", title })),
      availableTypes: ["note", "journey", "wireframe", "scape"],
      commands: true,
    } satisfies RouteContext,
  })),
);

export interface EvalResult {
  id: string;
  expected: RouteIntent;
  predicted: RouteIntent | null;
  confidence: number;
  ms: number;
}

export function evalResult(
  row: (typeof ROUTING_EVALS)[number],
  suggestion: RouteSuggestion | null,
): EvalResult {
  return {
    id: row.id,
    expected: row.intent,
    predicted: suggestion?.intent?.value ?? null,
    confidence: suggestion?.intent?.confidence ?? 0,
    ms: suggestion?.ms ?? 0,
  };
}

export function summarizeEval(results: EvalResult[]) {
  const confident = results.filter((row) => row.confidence >= 0.85 && row.predicted !== null);
  const times = results.map((row) => row.ms).sort((a, b) => a - b);
  const correct = results.filter((row) => row.predicted === row.expected).length;
  return {
    total: results.length,
    correct,
    accuracy: results.length ? correct / results.length : 0,
    confident: confident.length,
    confidentAccuracy: confident.length
      ? confident.filter((r) => r.predicted === r.expected).length / confident.length
      : 0,
    coverage: results.length ? confident.length / results.length : 0,
    p95Ms: times[Math.max(0, Math.ceil(times.length * 0.95) - 1)] ?? 0,
    failures: results.filter((row) => row.predicted !== row.expected).map((row) => row.id),
  };
}
