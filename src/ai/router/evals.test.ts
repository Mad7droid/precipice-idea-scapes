import { describe, expect, it } from "vitest";
import { ROUTING_EVALS, evalResult, summarizeEval } from "./evals";
import { heuristicRoute } from "./heuristics";

describe("routing evaluation", () => {
  it("covers 100 unique fictional requests and reports abstentions as misses", () => {
    expect(ROUTING_EVALS).toHaveLength(100);
    expect(new Set(ROUTING_EVALS.map((row) => row.text)).size).toBe(100);
    const report = summarizeEval(
      ROUTING_EVALS.map((row) => evalResult(row, heuristicRoute(row.text, row.context))),
    );
    expect(report.total).toBe(100);
    expect(summarizeEval([evalResult(ROUTING_EVALS[0], null)]).accuracy).toBe(0);
  });

  it("reports high-confidence accuracy separately from coverage", () => {
    const rows = [
      {
        ...evalResult(ROUTING_EVALS[0], null),
        predicted: "ask" as const,
        confidence: 0.9,
        ms: 700,
      },
      { ...evalResult(ROUTING_EVALS[1], null), ms: 800 },
    ];
    const summary = summarizeEval(rows);
    expect(summary.accuracy).toBe(0.5);
    expect(summary.confidentAccuracy).toBe(1);
    expect(summary.coverage).toBe(0.5);
    expect(summary.p95Ms).toBe(800);
  });
});
