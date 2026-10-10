import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scapi, type ScapiState } from "./Scapi";

/** Clicking is play: friendly reactions only, never over real work, always back to the truth. */

const calls = vi.hoisted(() => [] as string[]);
vi.mock("./scapi-controller.js", () => ({
  createScapi: () => ({
    setState: (value: string) => calls.push(`state:${value}`),
    setGaze: (value: string) => calls.push(`gaze:${value}`),
    setEffects: () => {},
    setReducedMotion: () => {},
    destroy: () => {},
  }),
}));

let root: Root;
let container: HTMLElement;
const show = (state: ScapiState) =>
  act(() => root.render(<Scapi state={state} size={144} playful />));
const click = () =>
  act(() =>
    container.querySelector("canvas")!.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
const states = () => calls.filter((c) => c.startsWith("state:")).map((c) => c.slice(6));

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  calls.length = 0;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("Scapi play", () => {
  it("cycles friendly reactions and returns to idle", () => {
    show("idle");
    calls.length = 0;
    for (let i = 0; i < 4; i++) {
      click();
      act(() => vi.advanceTimersByTime(3000));
    }
    expect(states()).not.toContain("error");
    expect(states()).not.toContain("concerned");
    expect(states()).toEqual(expect.arrayContaining(["wink", "happy", "success", "idle"]));
    expect(states().at(-1)).toBe("idle");
    expect(calls.at(-1)).toBe("gaze:front");
  });

  it("ignores clicks while Scapi is working", () => {
    show("thinking");
    calls.length = 0;
    click();
    expect(calls).toEqual([]);
  });

  it("lets a real state change cancel a reaction in progress", () => {
    show("idle");
    click();
    show("thinking");
    calls.length = 0;
    act(() => vi.advanceTimersByTime(3000));
    expect(calls).toEqual([]);
  });
});
