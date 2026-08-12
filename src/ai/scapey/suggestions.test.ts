import { describe, expect, it } from "vitest";
import { fixtureScape } from "@/core/fixtures";
import { suggestScapeyQuestions } from "./suggestions";

describe("Scapey suggestions", () => {
  it("derives questions from the open canvas", () => {
    const scape = fixtureScape();
    const suggestions = suggestScapeyQuestions(scape);
    expect(suggestions).toContain("Compare the wireframes and explain the trade-offs.");
    expect(suggestions).toContain("What's missing from this scape?");
  });

  it("offers an orphan question only when the scape has one", () => {
    const scape = fixtureScape();
    for (const id of scape.objectOrder) {
      scape.relationships[`rel_${id}`] = { id: `rel_${id}`, from: id, to: id };
    }
    expect(suggestScapeyQuestions(scape)).not.toContain(
      "Which objects aren't connected to anything?",
    );
  });
});
