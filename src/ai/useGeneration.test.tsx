import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyScape } from "@/core/fixtures";
import { useScapeStore } from "@/core/store";
import { render } from "@/test/react";
import type { GenerationEvent } from "./applier";

type Call = { onEvent: (e: GenerationEvent) => void; resolve: () => void; signal: AbortSignal };
const calls: Call[] = [];

vi.mock("./generate", () => ({
  generate: (opts: { onEvent: (e: GenerationEvent) => void; signal: AbortSignal }) =>
    new Promise<void>((resolve) => {
      calls.push({ onEvent: opts.onEvent, resolve, signal: opts.signal });
    }),
}));

const { useGeneration } = await import("./useGeneration");

beforeEach(() => {
  calls.length = 0;
  useScapeStore.getState().loadScape(emptyScape("scp_gen"));
});

describe("useGeneration run tokens", () => {
  it("ignores the aborted run's done event and finally once a newer run has started", async () => {
    const result = { current: null as unknown as ReturnType<typeof useGeneration> };
    function Harness() {
      result.current = useGeneration();
      return null;
    }
    render(<Harness />);
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.start({ request: "one", apiKey: "k", modelId: "m1" });
    });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    act(() => {
      second = result.current.start({ request: "two", apiKey: "k", modelId: "m2" });
    });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]!.signal.aborted).toBe(true);

    // The aborted run finishes late.
    await act(async () => {
      calls[0]!.onEvent({ kind: "done", applied: 0, model: "m1", txId: "old" } as GenerationEvent);
      calls[0]!.resolve();
      await first;
    });
    expect(result.current.state.status).toBe("streaming");
    expect(result.current.state.model).toBe("m2");
    expect(useScapeStore.getState().generating).toBe(true);

    await act(async () => {
      calls[1]!.onEvent({ kind: "done", applied: 2, model: "m2", txId: "new" } as GenerationEvent);
      calls[1]!.resolve();
      await second;
    });
    expect(result.current.state.status).toBe("done");
    expect(result.current.state.txId).toBe("new");
    expect(useScapeStore.getState().generating).toBe(false);
  });
});
