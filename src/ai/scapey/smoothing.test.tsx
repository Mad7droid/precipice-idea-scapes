import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureScape } from "@/core/fixtures";
import { render } from "@/test/react";
import type { AskEvent } from "./types";
import { useScapey } from "./useScapey";

/**
 * The smoothing buffer.
 *
 * Text arrives in bursts shaped by the network; it has to leave at a steady rate, and a turn
 * must never look finished while there is still buffered text to show. Both are UX guarantees
 * rather than correctness ones, which is exactly why they need a test — nothing else in the
 * suite would notice them regressing.
 */

const stub = vi.hoisted(() => ({
  emit: null as ((event: AskEvent) => void) | null,
  finish: null as (() => void) | null,
}));

vi.mock("./ask", () => ({
  ask: (options: { onEvent: (event: AskEvent) => void }) => {
    stub.emit = options.onEvent;
    return new Promise<void>((resolve) => {
      stub.finish = resolve;
    });
  },
}));

beforeEach(() => {
  sessionStorage.clear();
  stub.emit = null;
  stub.finish = null;
});

afterEach(() => vi.unstubAllGlobals());

async function harness(start = true) {
  const scape = fixtureScape();
  let api!: ReturnType<typeof useScapey>;

  function Probe() {
    api = useScapey({
      getScape: () => scape,
      apiKey: "sk-ant-test",
      modelId: "claude-sonnet-5",
      scapeId: "scp_smoothing",
    });
    return null;
  }

  const mounted = render(<Probe />);

  // `send` awaits a dynamic import before calling the mocked `ask`, so the microtask queue has
  // to drain before events can be pushed.
  if (start) {
    await act(async () => {
      void api.send("A question");
    });
  }

  return {
    mounted,
    read: () => api,
    emit: (event: AskEvent) => act(() => stub.emit?.(event)),
    turn: () => api.turns[api.turns.length - 1],
  };
}

describe("smoothing buffer", () => {
  it("holds a burst off-screen until the complete answer can paint once", async () => {
    const h = await harness();
    const burst = "x".repeat(400);

    h.emit({ kind: "text", text: burst });
    expect(h.turn().body).toBe("");
    h.emit({ kind: "done", turn: { user: { role: "user", content: "q" }, response: [] } });
    expect(h.turn().body).toBe(burst);
    expect(h.turn().status).toBe("done");

    h.mounted.unmount();
  });

  it("does not reflow a trickle as individual provider chunks", async () => {
    const h = await harness();
    h.emit({ kind: "text", text: "hi" });
    expect(h.turn().body).toBe("");
    h.emit({ kind: "done", turn: { user: { role: "user", content: "q" }, response: [] } });
    expect(h.turn().body).toBe("hi");
    h.mounted.unmount();
  });

  it("drains reasoning before the answer", async () => {
    const h = await harness();
    h.emit({ kind: "reasoning", text: "r".repeat(50) });
    h.emit({ kind: "text", text: "a".repeat(50) });
    h.emit({ kind: "done", turn: { user: { role: "user", content: "q" }, response: [] } });

    expect(h.turn().reasoning).toBe("r".repeat(50));
    expect(h.turn().body).toBe("a".repeat(50));
    h.mounted.unmount();
  });

  it("completes only after it has painted the buffered response", async () => {
    const h = await harness();
    h.emit({ kind: "text", text: "y".repeat(400) });
    h.emit({ kind: "done", turn: { user: { role: "user", content: "q" }, response: [] } });

    expect(h.turn().body).toHaveLength(400);
    expect(h.turn().status).toBe("done");
    expect(h.read().streaming).toBe(false);
    h.mounted.unmount();
  });

  it("shows everything at once when the user stops it", async () => {
    const h = await harness();
    h.emit({ kind: "text", text: "z".repeat(400) });
    expect(h.turn().body).toBe("");

    // Stop means stop. Holding buffered text back after the user asked it to end is the one
    // moment smoothing would be felt as latency rather than as polish.
    act(() => h.read().cancel());
    expect(h.turn().body).toHaveLength(400);
    expect(h.turn().status).toBe("cancelled");
    h.mounted.unmount();
  });
});

describe("activity", () => {
  it("records steps immediately, without waiting on the text buffer", async () => {
    const h = await harness();
    h.emit({ kind: "activity", event: { kind: "reading-scape", objects: 12 } });
    h.emit({ kind: "text", text: "q".repeat(400) });

    // The status line leads the prose it describes — that is the point of it.
    expect(h.turn().activity).toHaveLength(1);
    expect(h.turn().body).toBe("");
    h.mounted.unmount();
  });
});

describe("lifecycle", () => {
  it("restores the display transcript before it writes session storage", async () => {
    const saved = {
      id: "turn_saved",
      question: "Earlier question",
      pinned: [],
      reasoning: "",
      body: "Earlier answer",
      activity: [],
      sources: [],
      status: "done" as const,
      error: null,
    };
    sessionStorage.setItem("precipice.scapey.scp_smoothing", JSON.stringify([saved]));

    const h = await harness(false);
    expect(h.read().turns).toEqual([saved]);
    expect(JSON.parse(sessionStorage.getItem("precipice.scapey.scp_smoothing") ?? "[]")).toEqual([
      saved,
    ]);
    h.mounted.unmount();
  });

  it("opens one streaming turn per send", async () => {
    const h = await harness();
    expect(h.read().turns).toHaveLength(1);
    expect(h.read().streaming).toBe(true);

    await act(async () => {
      void h.read().send("Ignored while busy");
    });
    expect(h.read().turns).toHaveLength(1);
    h.mounted.unmount();
  });

  it("clear drops the transcript and stops streaming", async () => {
    const h = await harness();
    act(() => h.read().clear());
    expect(h.read().turns).toHaveLength(0);
    expect(h.read().streaming).toBe(false);
    h.mounted.unmount();
  });
});
