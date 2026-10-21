import { describe, expect, it, vi } from "vitest";
import { askJev, buildRequest, parseAnswers } from "./jev";
import type { RouteContext } from "./types";
const context: RouteContext = {
  input: "voice",
  selection: { count: 1, types: ["note"] },
  objects: [{ id: "a", type: "note", title: "Roadmap" }],
  availableTypes: ["note"],
  commands: true,
};
describe("Jev transport and validation", () => {
  it("projects only allowed context, excluding arbitrary object bodies", () => {
    const request = buildRequest("zoom to roadmap", {
      ...context,
      objects: [{ ...context.objects[0], body: "SECRET" } as RouteContext["objects"][number]],
    });
    expect(JSON.stringify(request)).not.toContain("SECRET");
    expect(JSON.stringify(request)).toContain("Roadmap");
  });
  it("drops out-of-range confidence and prototype names", () => {
    for (const intent of [
      { choice: "ask", confidence: 2 },
      { choice: "toString", confidence: 1 },
    ]) {
      expect(parseAnswers({ answers: { intent } }, context, 0)?.intent).toBeUndefined();
    }
  });
  it("uses target confidence to gate focus commands", () => {
    const result = parseAnswers(
      {
        answers: {
          intent: { choice: "command", confidence: 0.99 },
          command: { choice: "focus", confidence: 0.99 },
          target: { choice: "a", confidence: 0.65 },
        },
      },
      context,
      0,
    );
    expect(result?.command?.confidence).toBe(0.65);
    expect(
      parseAnswers(
        {
          answers: {
            intent: { choice: "command", confidence: 1 },
            command: { choice: "undo", confidence: 1 },
          },
        },
        { ...context, commands: false },
        0,
      )?.command,
    ).toBeUndefined();
  });
  it("never starts a request after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    expect(await askJev("create a note", context, "test", controller.signal, fetcher)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("abandons an unresponsive request after 800 ms", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(
        (_url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }),
      );
      const answer = askJev("create a note", context, "fictional-key", undefined, fetcher);
      await vi.advanceTimersByTimeAsync(800);
      expect(await answer).toBeNull();
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
