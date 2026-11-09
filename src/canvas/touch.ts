import { useEffect, useRef } from "react";
import { TOUCH } from "@/core/viewport";

export interface CanvasTouchHandlers {
  /** Two fingers down and up without moving: undo (twin: Undo in the action bar). */
  onTwoFingerTap: () => void;
  /** Two quick taps on empty canvas: fit view (twin: Fit view in the toolbar). */
  onPaneDoubleTap: () => void;
  /** Press and hold on empty canvas: add here (twin: Add in the action bar). */
  onPaneLongPress: (point: { x: number; y: number }) => void;
}

/** Empty canvas, as opposed to a node, an edge, a handle or a control floating over it. */
export function isPaneTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.closest) return false;
  return (
    Boolean(el.closest(".react-flow__pane")) && !el.closest(".react-flow__node, .react-flow__edge")
  );
}

/**
 * The canvas gestures React Flow does not provide, from GESTURES in src/core/viewport.ts.
 *
 * Native touch events on the surface element, passive, so React Flow's own pan and pinch keep
 * working untouched: nothing here calls preventDefault. Capture phase, because d3-zoom stops
 * propagation of touch events on the pane, so a bubbling listener never hears them. Each gesture is cancelled by movement
 * past `TOUCH.moveTolerance`, which is what keeps a pinch from also counting as a
 * two-finger tap and a pan from also counting as a long-press.
 */
export function useCanvasTouch(
  surface: React.RefObject<HTMLElement | null>,
  handlers: CanvasTouchHandlers,
  enabled: boolean,
) {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const el = surface.current;
    if (!el || !enabled) return;

    let multi: { t: number; points: { x: number; y: number }[]; moved: boolean } | null = null;
    let press: { x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
    let lastTap: { t: number; x: number; y: number } | null = null;
    let single: { x: number; y: number; t: number; pane: boolean; moved: boolean } | null = null;

    const cancelPress = () => {
      if (press) clearTimeout(press.timer);
      press = null;
    };

    const onStart = (event: TouchEvent) => {
      const touches = Array.from(event.touches);
      if (touches.length === 2) {
        cancelPress();
        single = null;
        multi = {
          t: event.timeStamp,
          points: touches.map((t) => ({ x: t.clientX, y: t.clientY })),
          moved: false,
        };
        return;
      }
      if (touches.length !== 1) {
        multi = null;
        cancelPress();
        return;
      }
      const touch = touches[0];
      const pane = isPaneTarget(event.target);
      single = { x: touch.clientX, y: touch.clientY, t: event.timeStamp, pane, moved: false };
      if (!pane) return;
      const point = { x: touch.clientX, y: touch.clientY };
      press = {
        ...point,
        timer: setTimeout(() => {
          press = null;
          single = null;
          lastTap = null;
          navigator.vibrate?.(10);
          latest.current.onPaneLongPress(point);
        }, TOUCH.longPressMs),
      };
    };

    const onMove = (event: TouchEvent) => {
      const touches = Array.from(event.touches);
      if (multi) {
        touches.forEach((t, i) => {
          const start = multi?.points[i];
          if (start && Math.hypot(t.clientX - start.x, t.clientY - start.y) > TOUCH.moveTolerance) {
            multi!.moved = true;
          }
        });
      }
      const t = touches[0];
      if (
        single &&
        t &&
        Math.hypot(t.clientX - single.x, t.clientY - single.y) > TOUCH.moveTolerance
      ) {
        single.moved = true;
        cancelPress();
      }
    };

    const onEnd = (event: TouchEvent) => {
      cancelPress();
      if (multi) {
        if (event.touches.length > 0) return;
        const quick = event.timeStamp - multi.t < TOUCH.doubleTapMs;
        if (quick && !multi.moved) latest.current.onTwoFingerTap();
        multi = null;
        return;
      }
      const tap = single;
      single = null;
      if (!tap || tap.moved || !tap.pane) return;
      if (event.timeStamp - tap.t > TOUCH.longPressMs) return;
      if (
        lastTap &&
        event.timeStamp - lastTap.t < TOUCH.doubleTapMs &&
        Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < TOUCH.hitMin
      ) {
        lastTap = null;
        latest.current.onPaneDoubleTap();
        return;
      }
      lastTap = { t: event.timeStamp, x: tap.x, y: tap.y };
    };

    const onCancel = () => {
      cancelPress();
      multi = null;
      single = null;
    };

    el.addEventListener("touchstart", onStart, { passive: true, capture: true });
    el.addEventListener("touchmove", onMove, { passive: true, capture: true });
    el.addEventListener("touchend", onEnd, { passive: true, capture: true });
    el.addEventListener("touchcancel", onCancel, { passive: true, capture: true });
    return () => {
      cancelPress();
      el.removeEventListener("touchstart", onStart, { capture: true });
      el.removeEventListener("touchmove", onMove, { capture: true });
      el.removeEventListener("touchend", onEnd, { capture: true });
      el.removeEventListener("touchcancel", onCancel, { capture: true });
    };
  }, [surface, enabled]);
}
