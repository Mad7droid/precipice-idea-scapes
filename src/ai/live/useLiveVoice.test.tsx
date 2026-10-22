import { act, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, type Mounted } from "@/test/react";
import type { RouteContext, RouteSuggestion, SendRoute } from "@/ai/router/types";
import { SETTLE_MS, useLiveVoice } from "./useLiveVoice";

const remote = vi.hoisted(() => ({ ask: vi.fn(), request: vi.fn() }));
vi.mock("@/ai/router/jev", () => ({
  askJev: remote.ask,
  requestJev: remote.request,
  JEV_ONLY_TIMEOUT_MS: 4000,
}));

const context: RouteContext = {
  input: "voice",
  selection: { count: 0, types: [] },
  objects: [],
  availableTypes: [],
  commands: true,
};
const baseline = () => ({
  intent: "edit" as const,
  scope: "scape" as const,
  types: [],
  modelId: "claude-sonnet-5",
  webSearch: false,
  selectionCount: 0,
});

let view: Mounted | undefined;
afterEach(() => {
  view?.unmount();
  vi.useRealTimers();
  remote.ask.mockReset();
  remote.request.mockReset();
});

function mount(jevKey = "", failed = false, jevOnly = false) {
  const sent: string[] = [];
  const routes: SendRoute[] = [];
  const commands: string[] = [];
  let latest!: ReturnType<typeof useLiveVoice>;
  let setBusy!: (busy: boolean) => void;
  function Probe() {
    const [busy, set] = useState(false);
    setBusy = set;
    latest = useLiveVoice({
      baseline,
      context: () => context,
      jevKey,
      jevOnly,
      busy,
      failed,
      onSend: (text, route) => {
        sent.push(text);
        routes.push(route);
      },
      onCommand: (command) => commands.push(command.kind),
    });
    return null;
  }
  view = render(<Probe />);
  return {
    sent,
    routes,
    commands,
    live: () => latest,
    busy: (b: boolean) => act(() => setBusy(b)),
  };
}

const flush = () => act(async () => {});
const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("live voice", () => {
  it("runs each phrase after a short settle, in spoken order, one at a time", async () => {
    vi.useFakeTimers();
    const { sent, live, busy } = mount();
    act(() => live().push("add a checkout step"));
    await flush();
    expect(sent).toEqual([]);
    await wait(SETTLE_MS);
    expect(sent).toEqual(["add a checkout step"]);
    busy(true);
    act(() => live().push("add a payment step"));
    await wait(SETTLE_MS);
    expect(sent).toHaveLength(1);
    busy(false);
    await wait(0);
    expect(sent).toEqual(["add a checkout step", "add a payment step"]);
    expect(live().entries[0]).toMatchObject({ stage: "done", decider: "local", action: "Edit" });
  });

  it("joins words heard during the settle window into one request", async () => {
    vi.useFakeTimers();
    const { sent, live } = mount();
    act(() => live().push("so now connect it to a document"));
    await wait(300);
    act(() => live().push("that explains the claim"));
    await wait(SETTLE_MS);
    expect(sent).toEqual(["so now connect it to a document that explains the claim"]);
    expect(live().entries).toHaveLength(1);
  });

  it("reports a run that ended in an error as failed, not done", async () => {
    vi.useFakeTimers();
    const { live, busy } = mount("", true);
    act(() => live().push("add a checkout step"));
    await wait(SETTLE_MS);
    busy(true);
    busy(false);
    expect(live().entries[0]!.stage).toBe("failed");
  });

  it("runs local commands immediately", async () => {
    const { sent, commands, live } = mount();
    act(() => live().push("undo that"));
    await flush();
    expect(commands).toEqual(["undo"]);
    expect(sent).toEqual([]);
  });

  it("ignores a stale Jev answer once more words join the phrase, and reports who decided", async () => {
    const answers: ((value: RouteSuggestion | null) => void)[] = [];
    remote.ask.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const { live } = mount("key");
    act(() => live().push("make the onboarding journey"));
    act(() => live().push("a little longer"));
    await vi.waitFor(() => expect(answers).toHaveLength(2));
    await act(async () =>
      answers[0]!({ source: "jev", ms: 90, intent: { value: "ask", confidence: 0.95 } }),
    );
    expect(live().entries[0]!.stage).toBe("routing");
    await act(async () => answers[1]!(null));
    expect(live().entries[0]).toMatchObject({
      text: "make the onboarding journey a little longer",
      stage: "queued",
      decider: "fallback",
      action: "Edit",
    });
  });

  it("marks a run that never starts as not run, and moves on", async () => {
    vi.useFakeTimers();
    const { sent, live } = mount();
    act(() => live().push("add a note about pricing"));
    await wait(SETTLE_MS);
    await wait(1600);
    expect(live().entries[0]!.stage).toBe("skipped");
    act(() => live().push("add a note about churn"));
    await wait(SETTLE_MS);
    expect(sent).toEqual(["add a note about pricing", "add a note about churn"]);
  });

  it("passes the phrases said just before as spoken context", async () => {
    vi.useFakeTimers();
    const { routes, live, busy } = mount();
    act(() => live().push("add a checkout step"));
    await wait(SETTLE_MS);
    busy(true);
    busy(false);
    act(() => live().push("make it shorter"));
    await wait(SETTLE_MS);
    expect(routes[1]?.spoken).toEqual({ recent: ["add a checkout step"] });
  });

  it("with Jev only, never routes on-device and shows why Jev failed", async () => {
    remote.request.mockResolvedValue({
      ok: false,
      reason: "TypeSafe rejected the key (401)",
      ms: 120,
    });
    const { sent, commands, live } = mount("key", false, true);
    act(() => live().push("undo that"));
    await vi.waitFor(() => expect(live().entries[0]!.stage).toBe("failed"));
    expect(live().entries[0]!.error).toBe("TypeSafe rejected the key (401)");
    expect(commands).toEqual([]);
    expect(sent).toEqual([]);
    expect(remote.ask).not.toHaveBeenCalled();
  });

  it("with Jev only, runs Jev's own answer", async () => {
    vi.useFakeTimers();
    remote.request.mockResolvedValue({
      ok: true,
      suggestion: { source: "jev", ms: 300, intent: { value: "edit", confidence: 0.9 } },
    });
    const { sent, live } = mount("key", false, true);
    act(() => live().push("can you just simplify this"));
    await vi.waitFor(() => expect(live().entries[0]!.stage).toBe("queued"));
    await wait(SETTLE_MS);
    expect(sent).toEqual(["can you just simplify this"]);
    expect(live().entries[0]).toMatchObject({ decider: "jev", action: "Edit" });
  });
});
