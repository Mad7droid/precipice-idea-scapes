import { useSyncExternalStore } from "react";
import { MEDIA, layoutClassFor, type InputMode, type LayoutClass } from "@/core/viewport";

/**
 * The hooks every surface reads to decide how to lay itself out and how to take input.
 *
 * Layout comes from width; input comes from the pointer. See src/core/viewport.ts for why
 * those are two questions and not one.
 */

function subscribeMedia(query: string) {
  return (onChange: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const list = window.matchMedia(query);
    list.addEventListener?.("change", onChange);
    return () => list.removeEventListener?.("change", onChange);
  };
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribeMedia(query),
    () => (typeof window !== "undefined" && window.matchMedia?.(query).matches) || false,
    () => false,
  );
}

function subscribeResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  window.addEventListener("orientationchange", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    window.removeEventListener("orientationchange", onChange);
  };
}

export function useLayoutClass(): LayoutClass {
  return useSyncExternalStore(
    subscribeResize,
    () => layoutClassFor(window.innerWidth),
    () => "expanded",
  );
}

export function useInputMode(): InputMode {
  return useMediaQuery(MEDIA.coarse) ? "coarse" : "fine";
}

/** True when there is no hovering pointer — hover-only affordances must be shown instead. */
export function useHoverNone(): boolean {
  return useMediaQuery(MEDIA.hoverNone);
}

/** True when launched from the home screen as an installed app. */
export function useStandalone(): boolean {
  const media = useMediaQuery(MEDIA.standalone);
  const iosStandalone =
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return media || iosStandalone;
}

export interface VisualViewportState {
  /** Visible height, CSS px. Shrinks when the on-screen keyboard opens. */
  height: number;
  /** How much of the layout viewport the keyboard (or other UI) covers at the bottom. */
  keyboardInset: number;
}

let cached: VisualViewportState = { height: 0, keyboardInset: 0 };

function readVisualViewport(): VisualViewportState {
  const vv = window.visualViewport;
  const height = vv?.height ?? window.innerHeight;
  const inset = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  const next = { height: Math.round(height), keyboardInset: Math.round(inset) };
  // useSyncExternalStore needs a stable snapshot between changes.
  if (next.height !== cached.height || next.keyboardInset !== cached.keyboardInset) cached = next;
  return cached;
}

function subscribeVisualViewport(onChange: () => void) {
  const vv = window.visualViewport;
  vv?.addEventListener("resize", onChange);
  vv?.addEventListener("scroll", onChange);
  window.addEventListener("resize", onChange);
  return () => {
    vv?.removeEventListener("resize", onChange);
    vv?.removeEventListener("scroll", onChange);
    window.removeEventListener("resize", onChange);
  };
}

/**
 * The part of the screen the user can actually see. Use `keyboardInset` to lift anything
 * docked to the bottom (composer, sheets) above the on-screen keyboard.
 */
export function useVisualViewport(): VisualViewportState {
  return useSyncExternalStore(subscribeVisualViewport, readVisualViewport, () => cached);
}
