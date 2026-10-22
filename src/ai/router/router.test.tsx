import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, type Mounted } from "@/test/react";
import { decide, type RouteBaseline } from "./decide";
import { heuristicRoute } from "./heuristics";
import { useRoute } from "./useRoute";
import type { RouteContext, RouteSuggestion } from "./types";

const remote = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock("./jev", () => ({
  askJev: remote.ask,
  JEV_ONLY_TIMEOUT_MS: 4000,
  // The hook asks through requestJev; the tests script answers through `remote.ask`.
  requestJev: (text: string, context: unknown, key: string, options: { signal?: AbortSignal }) =>
    Promise.resolve(remote.ask(text, context, key, options.signal)).then((suggestion) =>
      suggestion ? { ok: true, suggestion } : { ok: false, reason: "no answer", ms: 0 },
    ),
}));
const context: RouteContext = {
  input: "typed",
  selection: { count: 1, types: ["note"] },
  objects: [{ id: "a", type: "note", title: "Roadmap" }],
  availableTypes: ["note"],
  commands: true,
};
const baseline: RouteBaseline = {
  intent: "edit",
  scope: "scape",
  types: [],
  modelId: "claude-sonnet-5",
  webSearch: true,
  selectionCount: 1,
};

describe("routing boundaries", () => {
  it.each(["edit", "connect"] as const)("never combines %s with web search", (intent) => {
    expect(
      decide(
        baseline,
        {
          source: "jev",
          ms: 0,
          intent: { value: intent, confidence: 1 },
          webSearch: { value: true, confidence: 1 },
        },
        new Set(),
      ).route.webSearch,
    ).toBe(false);
  });
  it("keeps manual intent and model overrides", () => {
    const result = decide(
      baseline,
      {
        source: "jev",
        ms: 0,
        intent: { value: "ask", confidence: 1 },
        tier: { value: "instant", confidence: 1 },
      },
      new Set(["intent", "tier"]),
    );
    expect(result.route.intent).toBe("edit");
    expect(result.route.modelId).toBe(baseline.modelId);
  });
  it("ignores uncertain intent and empty selections", () => {
    const result = decide(
      { ...baseline, scope: "selection", selectionCount: 0 },
      {
        source: "jev",
        ms: 0,
        intent: { value: "ask", confidence: 0.59 },
      },
      new Set(),
    );
    expect(result.route.intent).toBe("edit");
    expect(result.route.scope).toBe("scape");
  });
  it("recognises commands without executing anything", () => {
    const suggestion = heuristicRoute("undo that", context);
    expect(decide(baseline, suggestion, new Set()).command).toEqual({ kind: "undo" });
    expect(heuristicRoute("delete everything", context).command).toBeUndefined();
    expect(
      heuristicRoute("zoom to roadmap", { ...context, commands: false }).command,
    ).toBeUndefined();
  });
});

let view: Mounted | undefined;
afterEach(() => {
  view?.unmount();
  vi.useRealTimers();
  remote.ask.mockReset();
});
it("aborts old answers as soon as typing resumes and clears stale command chips", async () => {
  vi.useFakeTimers();
  let draft = "zoom to roadmap";
  let latest!: ReturnType<typeof useRoute>;
  let finish!: (answer: RouteSuggestion) => void;
  remote.ask.mockImplementation(
    () =>
      new Promise<RouteSuggestion>((resolve) => {
        finish = resolve;
      }),
  );
  let refresh!: () => void;
  function Probe() {
    const [, rerender] = useState(0);
    refresh = () => rerender((n) => n + 1);
    latest = useRoute({ text: draft, enabled: true, jevKey: "test", getContext: () => context });
    return null;
  }
  view = render(<Probe />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(latest.suggestion?.command?.value.kind).toBe("focus");
  const signal = remote.ask.mock.calls[0][3] as AbortSignal;
  act(() => {
    draft = "create a checkout wireframe";
    refresh();
  });
  expect(signal.aborted).toBe(true);
  expect(latest.suggestion).toBeNull();
  await act(async () => {
    finish({ source: "jev", ms: 10, intent: { value: "ask", confidence: 1 } });
  });
  expect(latest.suggestion).toBeNull();
});
import { useState } from "react";

describe("who decided the route", () => {
  async function settle(answer: Promise<RouteSuggestion | null>) {
    vi.useFakeTimers();
    remote.ask.mockReturnValue(answer);
    let latest!: ReturnType<typeof useRoute>;
    function Probe() {
      latest = useRoute({
        text: "make a checkout flow for returning customers",
        enabled: true,
        jevKey: "test",
        getContext: () => context,
      });
      return null;
    }
    view = render(<Probe />);
    expect(latest.jev).toBe("off");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    return () => latest;
  }

  it("reports Jev while it is asked and after it answers", async () => {
    let finish!: (answer: RouteSuggestion) => void;
    const latest = await settle(new Promise((resolve) => (finish = resolve)));
    expect(latest().jev).toBe("asking");
    await act(async () => {
      finish({ source: "jev", ms: 120, intent: { value: "edit", confidence: 0.9 } });
    });
    expect(latest().jev).toBe("answered");
    expect(latest().suggestion?.source).toBe("jev");
  });

  it("reports an on-device fallback when Jev gives no answer", async () => {
    const latest = await settle(Promise.resolve(null));
    await act(async () => {});
    expect(latest().jev).toBe("fallback");
    expect(latest().suggestion?.source).toBe("heuristic");
  });
});

it("with Jev only, shows no on-device route and reports why Jev failed", async () => {
  vi.useFakeTimers();
  remote.ask.mockResolvedValue(null);
  let latest!: ReturnType<typeof useRoute>;
  function Probe() {
    latest = useRoute({
      text: "add a checkout step",
      enabled: true,
      jevKey: "test",
      jevOnly: true,
      getContext: () => context,
    });
    return null;
  }
  view = render(<Probe />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  await act(async () => {});
  expect(latest.jev).toBe("failed");
  expect(latest.jevError).toBe("no answer");
  expect(latest.suggestion).toBeNull();
});
