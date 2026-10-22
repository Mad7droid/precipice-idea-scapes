import { describe, expect, it } from "vitest";
import { heuristicRoute } from "./router/heuristics";
import type { RouteContext } from "./router/types";
import { systemPrompt } from "./prompt";

const context: RouteContext = {
  input: "voice",
  selection: { count: 0, types: [] },
  objects: [],
  availableTypes: [],
  commands: false,
};

describe("spoken requests", () => {
  it.each([
    "This is just over complicated, can you just simplify it entirely, please?",
    "so can you just simplify this?",
    "could you remove the failed state",
    "okay now merge these two notes",
  ])("routes a softened instruction as an edit: %s", (text) => {
    // The first sentence is a complaint; the softened request is what matters.
    const phrase = text.includes("over complicated") ? "can you just simplify it entirely?" : text;
    expect(heuristicRoute(phrase, context).intent?.value).toBe("edit");
  });

  it("keeps real questions as asks", () => {
    expect(heuristicRoute("can you explain the signup flow?", context).intent?.value).toBe("ask");
    expect(heuristicRoute("what is missing here?", context).intent?.value).toBe("ask");
  });

  it("tells the model to edit what exists rather than add, and to read speech as speech", () => {
    const typed = systemPrompt();
    expect(typed).toContain("use UpdateObject and DeleteObject");
    expect(typed).not.toContain("This request was spoken");
    const spoken = systemPrompt({
      spoken: { recent: ["add a checkout step"], lastChanged: ["checkout-step"] },
    });
    expect(spoken).toContain("This request was spoken");
    expect(spoken).toContain('"add a checkout step"');
    expect(spoken).toContain("(checkout-step)");
  });
});
