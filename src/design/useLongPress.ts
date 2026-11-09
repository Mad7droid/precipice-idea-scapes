import { useCallback, useEffect, useRef } from "react";
import { TOUCH } from "@/core/viewport";

export interface LongPressPoint {
  clientX: number;
  clientY: number;
}

/**
 * Long-press for touch, without breaking click or scroll.
 *
 * Fires after `TOUCH.longPressMs` if the pointer has not moved more than
 * `TOUCH.moveTolerance`. Any movement beyond that cancels, so a scroll or pan that happens
 * to start on a row never opens its menu. When it fires, the click that follows the release
 * is swallowed so the row isn't also opened.
 *
 * Mouse pointers are ignored: on desktop the same callback is wired to `onContextMenu`
 * instead, which this hook also returns so a surface wires one thing.
 */
export function useLongPress(
  onLongPress: (point: LongPressPoint) => void,
  { disabled = false }: { disabled?: boolean } = {},
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const callback = useRef(onLongPress);
  callback.current = onLongPress;

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      fired.current = false;
      if (disabled || event.pointerType === "mouse" || !event.isPrimary) return;
      origin.current = { x: event.clientX, y: event.clientY };
      const point = { clientX: event.clientX, clientY: event.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        navigator.vibrate?.(10);
        callback.current(point);
      }, TOUCH.longPressMs);
    },
    [disabled],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!origin.current) return;
      const dx = event.clientX - origin.current.x;
      const dy = event.clientY - origin.current.y;
      if (Math.hypot(dx, dy) > TOUCH.moveTolerance) cancel();
    },
    [cancel],
  );

  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (!fired.current) return;
    fired.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const onContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if (disabled) return;
      // Touch browsers also fire contextmenu on long-press; the timer already handled it.
      // Whichever comes first wins; the other is ignored, so the menu opens exactly once.
      event.preventDefault();
      if (fired.current) return;
      const fromTouch = origin.current !== null;
      cancel();
      fired.current = fromTouch;
      callback.current({ clientX: event.clientX, clientY: event.clientY });
    },
    [disabled, cancel],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClickCapture,
    onContextMenu,
  };
}
