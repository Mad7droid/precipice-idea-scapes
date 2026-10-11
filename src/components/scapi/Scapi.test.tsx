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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

describe("idle chat reactions", () => {
  let visibility: IntersectionObserverCallback;
  let media: MediaQueryList;
  let hidden = false;

  beforeEach(() => {
    const events = new EventTarget();
    media = {
      matches: false,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    } as MediaQueryList;
    vi.spyOn(window, "matchMedia").mockReturnValue(media);
    hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          visibility = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
  });

  const ambient = (state: ScapiState = "idle") =>
    act(() => root.render(<Scapi state={state} size={56} playful idleReactions />));
  const visible = (isIntersecting: boolean) =>
    act(() =>
      visibility([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver),
    );

  it("occasionally plays friendly reactions while idle and returns to rest", () => {
    ambient();
    visible(true);
    calls.length = 0;
    act(() => vi.advanceTimersByTime(12000));
    expect(states()).toEqual(["happy"]);
    act(() => vi.advanceTimersByTime(1200));
    expect(states().at(-1)).toBe("idle");
    act(() => vi.advanceTimersByTime(12000));
    expect(states()).not.toContain("error");
    expect(states()).not.toContain("success");
  });

  it("pauses offscreen and lets a new request interrupt idle play", () => {
    ambient();
    visible(true);
    act(() => vi.advanceTimersByTime(12000));
    visible(false);
    calls.length = 0;
    act(() => vi.advanceTimersByTime(30000));
    expect(calls).toEqual([]);
    visible(true);
    act(() => vi.advanceTimersByTime(12000));
    ambient("thinking");
    expect(states().at(-1)).toBe("thinking");
    calls.length = 0;
    act(() => vi.advanceTimersByTime(30000));
    expect(calls).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pauses when the document hides and resumes without catching up", () => {
    ambient();
    visible(true);
    hidden = true;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    calls.length = 0;
    act(() => vi.advanceTimersByTime(60000));
    expect(calls).toEqual([]);
    hidden = false;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(() => vi.advanceTimersByTime(11999));
    expect(calls).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(states()).toEqual(["happy"]);
  });

  it("stops automatic play when reduced motion is enabled", () => {
    ambient();
    visible(true);
    act(() => vi.advanceTimersByTime(12000));
    Object.defineProperty(media, "matches", { value: true });
    act(() => media.dispatchEvent(new Event("change")));
    calls.length = 0;
    act(() => vi.advanceTimersByTime(30000));
    expect(calls).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
