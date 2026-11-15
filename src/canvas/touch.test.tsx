import { act, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/test/react";
import { TOUCH } from "@/core/viewport";
import { isPaneTarget, useCanvasTouch, type CanvasTouchHandlers } from "./touch";

function Surface({ handlers }: { handlers: CanvasTouchHandlers }) {
  const ref = useRef<HTMLDivElement>(null);
  useCanvasTouch(ref, handlers, true);
  return (
    <div ref={ref}>
      <div className="react-flow__pane" data-testid="pane" />
      <div className="react-flow__pane">
        <div className="react-flow__node" data-testid="node" />
      </div>
    </div>
  );
}

let now = 1000;
function touch(el: Element, type: string, points: [number, number][], advance = 0) {
  now += advance;
  const list = points.map(([x, y]) => ({ clientX: x, clientY: y }));
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "touches", { value: list });
  Object.defineProperty(event, "timeStamp", { value: now });
  act(() => {
    el.dispatchEvent(event);
  });
}

function setup() {
  const handlers = {
    onTwoFingerTap: vi.fn(),
    onPaneDoubleTap: vi.fn(),
    onPaneLongPress: vi.fn(),
  };
  const mounted = render(<Surface handlers={handlers} />);
  const pane = mounted.container.querySelector("[data-testid=pane]")!;
  const node = mounted.container.querySelector("[data-testid=node]")!;
  return { handlers, pane, node, unmount: mounted.unmount };
}

describe("canvas touch gestures", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("tells the pane from a node", () => {
    const { pane, node, unmount } = setup();
    expect(isPaneTarget(pane)).toBe(true);
    expect(isPaneTarget(node)).toBe(false);
    unmount();
  });

  it("undoes on a still two-finger tap, but not on a pinch", () => {
    const { handlers, pane, unmount } = setup();
    touch(pane, "touchstart", [
      [10, 10],
      [60, 60],
    ]);
    touch(pane, "touchend", [], 120);
    expect(handlers.onTwoFingerTap).toHaveBeenCalledTimes(1);

    touch(
      pane,
      "touchstart",
      [
        [10, 10],
        [60, 60],
      ],
      1000,
    );
    touch(
      pane,
      "touchmove",
      [
        [0, 0],
        [90, 90],
      ],
      20,
    );
    touch(pane, "touchend", [], 60);
    expect(handlers.onTwoFingerTap).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("fits on a double-tap on empty canvas only", () => {
    const { handlers, pane, node, unmount } = setup();
    touch(node, "touchstart", [[20, 20]]);
    touch(node, "touchend", [], 50);
    touch(node, "touchstart", [[20, 20]], 80);
    touch(node, "touchend", [], 50);
    expect(handlers.onPaneDoubleTap).not.toHaveBeenCalled();

    touch(pane, "touchstart", [[20, 20]], 1000);
    touch(pane, "touchend", [], 50);
    touch(pane, "touchstart", [[22, 21]], 80);
    touch(pane, "touchend", [], 50);
    expect(handlers.onPaneDoubleTap).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("offers to add on a long-press on empty canvas, and a pan cancels it", () => {
    const { handlers, pane, unmount } = setup();
    touch(pane, "touchstart", [[40, 50]]);
    act(() => vi.advanceTimersByTime(TOUCH.longPressMs));
    expect(handlers.onPaneLongPress).toHaveBeenCalledWith({ x: 40, y: 50 });

    touch(pane, "touchend", [], TOUCH.longPressMs);
    touch(pane, "touchstart", [[40, 50]], 1000);
    touch(pane, "touchmove", [[40, 50 + TOUCH.moveTolerance + 5]], 30);
    act(() => vi.advanceTimersByTime(TOUCH.longPressMs * 2));
    expect(handlers.onPaneLongPress).toHaveBeenCalledTimes(1);
    unmount();
  });
});
