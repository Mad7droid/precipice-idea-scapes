import { describe, expect, it } from "vitest";
import {
  answerFormatLabel,
  inferAnswerFormat,
  MIN_THINKING_OUTPUT_TOKENS,
  responseGuidance,
  responseTokenBudget,
} from "./answerFormat";

describe("answer format hints", () => {
  it.each([
    ["Compare the two wireframes", "compare"],
    ["What risks are missing?", "suggest"],
    ["Which objects are orphaned?", "locate"],
    ["How do I improve this flow?", "suggest"],
    ["Research the current market", "research"],
    ["Summarise this scape", "summarise"],
    ["Detail out the entire thing with comparisons", "expand"],
    ["Give me an in-depth review", "expand"],
  ] as const)("infers %s as %s", (question, expected) => {
    expect(inferAnswerFormat(question)).toBe(expected);
  });

  it("keeps the generic label for a direct answer", () => {
    expect(answerFormatLabel("direct")).toBe("Scapi");
  });

  it("gives a concise, intent-specific brief to the model", () => {
    expect(responseGuidance("Summarise this flow")).toMatch(/at most four bullets/i);
    expect(responseGuidance("Why is verification broken?")).toMatch(/diagnosis/i);
    expect(responseGuidance("Simplify this")).toMatch(/plain language/i);
    expect(responseGuidance("Compare these wireframes")).toMatch(/two-column/i);
  });

  it("leaves the minimum API allowance required by adaptive thinking", () => {
    for (const question of ["Summarise this scape", "Expand on the decision flow"]) {
      expect(responseTokenBudget(question)).toBeGreaterThanOrEqual(MIN_THINKING_OUTPUT_TOKENS);
    }
  });
});
