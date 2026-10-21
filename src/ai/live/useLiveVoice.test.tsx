import { act, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, type Mounted } from "@/test/react";
import type { RouteContext, RouteSuggestion } from "@/ai/router/types";
import { useLiveVoice } from "./useLiveVoice";

const remote = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock("@/ai/router/jev", () => ({ askJev: remote.ask }));

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
});

function mount(jevKey = "") {
  const sent: string[] = [];
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
      busy,
      onSend: (text) => sent.push(text),
      onCommand: (command) => commands.push(command.kind),
    });
    return null;
  }
  view = render(<Probe />);
  return { sent, commands, live: () => latest, busy: (b: boolean) => act(() => setBusy(b)) };
}

const flush = () => act(async () => {});

describe("live voice", () => {
  it("runs phrases in spoken order, one at a time, without a Send", async () => {
    const { sent, live, busy } = mount();
    act(() => live().push("add a checkout step"));
    act(() => live().push("add a payment step"));
    await flush();
    expect(sent).toEqual(["add a checkout step"]);
    busy(true);
    busy(false);
    await flush();
    expect(sent).toEqual(["add a checkout step", "add a payment step"]);
    expect(live().entries[0]).toMatchObject({ stage: "done", decider: "local", action: "Edit" });
  });

  it("runs local commands immediately", async () => {
    const { sent, commands, live } = mount();
    act(() => live().push("undo that"));
    await flush();
    expect(commands).toEqual(["undo"]);
    expect(sent).toEqual([]);
  });

  it("keeps spoken order when Jev answers out of order, and reports who decided", async () => {
    const answers: ((value: RouteSuggestion | null) => void)[] = [];
    remote.ask.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const { sent, live } = mount("key");
    act(() => live().push("make the onboarding journey longer"));
    act(() => live().push("what is missing from this flow"));
    await vi.waitFor(() => expect(answers).toHaveLength(2));
    await act(async () =>
      answers[1]!({ source: "jev", ms: 90, intent: { value: "ask", confidence: 0.95 } }),
    );
    expect(sent).toEqual([]);
    await act(async () => answers[0]!(null));
    expect(sent).toEqual(["make the onboarding journey longer"]);
    expect(live().entries.map((entry) => entry.decider)).toEqual(["fallback", "jev"]);
    expect(live().entries[1]!.action).toBe("Ask");
  });

  it("marks a run that never starts as not run, and moves on", async () => {
    vi.useFakeTimers();
    const { sent, live } = mount();
    act(() => live().push("add a note about pricing"));
    act(() => live().push("add a note about churn"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(live().entries[0]!.stage).toBe("skipped");
    expect(sent).toEqual(["add a note about pricing", "add a note about churn"]);
  });
});
