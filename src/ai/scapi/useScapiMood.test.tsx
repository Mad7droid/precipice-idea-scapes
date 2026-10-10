import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Turn } from "./types";
import { SUCCESS_HOLD_MS, useScapiMood, type ScapiMood } from "./useScapiMood";

/**
 * The mascot is supplementary, but a mascot that celebrates history on every reopen, or whose
 * stale timer cancels a newer "thinking", is worse than none. These pin the lifecycle.
 */

function turn(id: string, status: Turn["status"]): Turn {
  return {
    id,
    question: "Why?",
    pinned: [],
    reasoning: "",
    body: status === "done" ? "Because." : "",
    activity: [],
    sources: [],
    status,
    error: status === "error" ? { message: "Failed", detail: "" } : null,
  };
}

let mood: ScapiMood;
function Probe({ turns, streaming, busy }: { turns: Turn[]; streaming: boolean; busy: boolean }) {
  mood = useScapiMood(turns, streaming, busy);
  return null;
}

let root: Root;
let container: HTMLElement;
function show(turns: Turn[], streaming = false, busy = false) {
  act(() => root.render(<Probe turns={turns} streaming={streaming} busy={busy} />));
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("useScapiMood", () => {
  it("does not react to history, including history hydrated after mount", () => {
    show([]);
    show([turn("a", "done"), turn("b", "error")]);
    expect(mood).toEqual({ state: "idle", reactionKey: 0 });
  });

  it("thinks while streaming, then reacts once to the completion and settles", () => {
    show([turn("a", "streaming")], true);
    expect(mood.state).toBe("thinking");

    show([turn("a", "done")]);
    expect(mood).toEqual({ state: "success", reactionKey: 1 });

    show([turn("a", "done")]);
    expect(mood.reactionKey).toBe(1);

    act(() => vi.advanceTimersByTime(SUCCESS_HOLD_MS));
    expect(mood.state).toBe("idle");
  });

  it("does not let a stale success timer override a newer request", () => {
    show([turn("a", "streaming")], true);
    show([turn("a", "done")]);
    show([turn("a", "done"), turn("b", "streaming")], true);
    act(() => vi.advanceTimersByTime(SUCCESS_HOLD_MS));
    expect(mood.state).toBe("thinking");
  });

  it("shows a real failure, treats a stop as neutral and clears on retry", () => {
    show([turn("a", "streaming")], true);
    show([turn("a", "error")]);
    expect(mood.state).toBe("error");

    show([turn("a", "streaming")], true);
    expect(mood.state).toBe("thinking");

    show([turn("a", "cancelled")]);
    expect(mood.state).toBe("idle");
  });

  it("thinks for an edit without a turn, but never reacts to it", () => {
    show([], false, true);
    expect(mood.state).toBe("thinking");
    show([]);
    expect(mood).toEqual({ state: "idle", reactionKey: 0 });
  });
});
