import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureScape } from "@/core/fixtures";
import { render } from "@/test/react";
import type { AskEvent } from "./types";
import { splitStableMarkdown, useScapi } from "./useScapi";

/**
 * The streaming buffer.
 *
 * Text arrives in bursts shaped by the network. It should leave at a steady rate, while an
 * unfinished Markdown construct remains invisible until it is safe to render. Both are UX
 * guarantees rather than correctness ones, which is exactly why they need a test.
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
  let api!: ReturnType<typeof useScapi>;

  function Probe() {
    api = useScapi({
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

async function flushFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

async function flushCadence() {
  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
  });
  await flushFrame();
}

describe("streaming buffer", () => {
  it("paints stable prose on the next frame instead of waiting for completion", async () => {
    const h = await harness();
    const burst = "Scapi is comparing the selected objects.";

    h.emit({ kind: "text", text: burst });
    expect(h.turn().body).toBe("");
    await flushFrame();
    expect(h.turn().body).toBe(burst);
    expect(h.turn().status).toBe("streaming");
    h.emit({ kind: "done", turn: { user: { role: "user", content: "q" }, response: [] } });
    expect(h.turn().body).toBe(burst);
    expect(h.turn().status).toBe("done");

    h.mounted.unmount();
  });

  it("coalesces a trickle until the next frame", async () => {
    const h = await harness();
    h.emit({ kind: "text", text: "hi" });
    expect(h.turn().body).toBe("");
    await flushFrame();
    expect(h.turn().body).toBe("");
    await flushCadence();
    expect(h.turn().body).toBe("hi");
    h.emit({ kind: "done", turn: { user: { role: "user", content: "q" }, response: [] } });
    expect(h.turn().body).toBe("hi");
    h.mounted.unmount();
  });

  it("drains reasoning before the answer", async () => {
    const h = await harness();
    h.emit({ kind: "reasoning", text: "r".repeat(50) });
    h.emit({ kind: "text", text: "a".repeat(50) });
    await flushCadence();
    expect(h.turn().reasoning).toBe("r".repeat(50));
    expect(h.turn().body).toBe("a".repeat(50));
    h.emit({ kind: "done", turn: { user: { role: "user", content: "q" }, response: [] } });

    expect(h.turn().reasoning).toBe("r".repeat(50));
    expect(h.turn().body).toBe("a".repeat(50));
    h.mounted.unmount();
  });

  it("completes only after it has painted the buffered response", async () => {
    const h = await harness();
    h.emit({ kind: "text", text: "y".repeat(400) });
    await flushFrame();
    h.emit({ kind: "done", turn: { user: { role: "user", content: "q" }, response: [] } });

    expect(h.turn().body).toHaveLength(400);
    expect(h.turn().status).toBe("done");
    expect(h.read().streaming).toBe(false);
    h.mounted.unmount();
  });

  it("shows everything at once when the user stops it", async () => {
    const h = await harness();
    h.emit({ kind: "text", text: "z".repeat(400) });
    await flushFrame();
    expect(h.turn().body).toHaveLength(400);

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
    await flushFrame();
    expect(h.turn().body).toHaveLength(400);
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
    sessionStorage.setItem("precipice.scapi.scp_smoothing", JSON.stringify([saved]));

    const h = await harness(false);
    expect(h.read().turns).toEqual([saved]);
    expect(JSON.parse(sessionStorage.getItem("precipice.scapi.scp_smoothing") ?? "[]")).toEqual([
      saved,
    ]);
    h.mounted.unmount();
  });

  it("migrates a Scapey transcript to the Scapi key without losing it", async () => {
    const saved = [
      {
        id: "turn_legacy",
        question: "Earlier",
        pinned: [],
        reasoning: "",
        body: "Answer",
        activity: [],
        sources: [],
        status: "done",
        error: null,
      },
    ];
    sessionStorage.setItem("precipice.scapey.scp_smoothing", JSON.stringify(saved));

    const h = await harness(false);
    expect(h.read().turns).toEqual(saved);
    expect(JSON.parse(sessionStorage.getItem("precipice.scapi.scp_smoothing") ?? "[]")).toEqual(
      saved,
    );
    expect(sessionStorage.getItem("precipice.scapey.scp_smoothing")).toBeNull();
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

describe("Markdown streaming safety", () => {
  it("holds incomplete links, emphasis, inline code, and fences until they are complete", () => {
    expect(splitStableMarkdown("Read [the guide")).toEqual({
      stable: "Read ",
      pending: "[the guide",
    });
    expect(splitStableMarkdown("Read [the guide](")).toEqual({
      stable: "Read ",
      pending: "[the guide](",
    });
    expect(splitStableMarkdown("Compare *these")).toEqual({
      stable: "Compare ",
      pending: "*these",
    });
    expect(splitStableMarkdown("Use `object_id")).toEqual({
      stable: "Use ",
      pending: "`object_id",
    });
    expect(splitStableMarkdown("Before\n| One | Two |\n| --- | --- |")).toEqual({
      stable: "Before\n",
      pending: "| One | Two |\n| --- | --- |",
    });
    expect(splitStableMarkdown("before\n```ts\nconst x = 1")).toEqual({
      stable: "before\n",
      pending: "```ts\nconst x = 1",
    });
  });

  it("passes complete Markdown through unchanged", () => {
    expect(splitStableMarkdown("Read [the guide](https://example.com).")).toEqual({
      stable: "Read [the guide](https://example.com).",
      pending: "",
    });
  });
});
