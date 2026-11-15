import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/test/react";
import { TOUCH } from "@/core/viewport";
import { useLongPress } from "./useLongPress";
import { Sheet } from "./Sheet";

/** jsdom has no PointerEvent; React only needs the type and the fields it reads. */
function pointer(el: Element, type: string, init: { x?: number; y?: number; pointerType?: string } = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.x ?? 0, clientY: init.y ?? 0 });
  Object.assign(event, { pointerType: init.pointerType ?? "touch", isPrimary: true, pointerId: 1 });
  act(() => {
    el.dispatchEvent(event);
  });
}

function Pressable({ onLongPress, onClick }: { onLongPress: () => void; onClick: () => void }) {
  const handlers = useLongPress(onLongPress);
  return (
    <button type="button" {...handlers} onClick={onClick}>
      Row
    </button>
  );
}

describe("useLongPress", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires after the hold and swallows the click that follows", () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const { container, unmount } = render(<Pressable onLongPress={onLongPress} onClick={onClick} />);
    const button = container.querySelector("button")!;

    pointer(button, "pointerdown");
    act(() => vi.advanceTimersByTime(TOUCH.longPressMs));
    expect(onLongPress).toHaveBeenCalledTimes(1);

    pointer(button, "pointerup");
    act(() => button.click());
    expect(onClick).not.toHaveBeenCalled();
    unmount();
  });

  it("is cancelled by movement past the tolerance", () => {
    const onLongPress = vi.fn();
    const { container, unmount } = render(<Pressable onLongPress={onLongPress} onClick={() => {}} />);
    const button = container.querySelector("button")!;

    pointer(button, "pointerdown", { x: 0, y: 0 });
    pointer(button, "pointermove", { x: 0, y: TOUCH.moveTolerance + 4 });
    act(() => vi.advanceTimersByTime(TOUCH.longPressMs * 2));
    expect(onLongPress).not.toHaveBeenCalled();
    unmount();
  });

  it("ignores the mouse but handles the context menu exactly once", () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const { container, unmount } = render(<Pressable onLongPress={onLongPress} onClick={onClick} />);
    const button = container.querySelector("button")!;

    pointer(button, "pointerdown", { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(TOUCH.longPressMs * 2));
    expect(onLongPress).not.toHaveBeenCalled();

    act(() => {
      button.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    expect(onLongPress).toHaveBeenCalledTimes(1);
    // A mouse right-click must not eat the next left click.
    act(() => button.click());
    expect(onClick).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("opens once when the browser's contextmenu beats the timer on touch", () => {
    const onLongPress = vi.fn();
    const { container, unmount } = render(<Pressable onLongPress={onLongPress} onClick={() => {}} />);
    const button = container.querySelector("button")!;

    pointer(button, "pointerdown");
    act(() => {
      button.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    act(() => vi.advanceTimersByTime(TOUCH.longPressMs * 2));
    expect(onLongPress).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe("Sheet", () => {
  it("renders nothing when closed", () => {
    const { unmount } = render(
      <Sheet open={false} onClose={() => {}} title="Settings">
        Body
      </Sheet>,
    );
    expect(document.querySelector("[role='dialog']")).toBeNull();
    unmount();
  });

  it("is a labelled modal dialog that closes from its button, the scrim and Escape", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <Sheet open onClose={onClose} title="Settings">
        <input aria-label="Key" />
      </Sheet>,
    );
    const dialog = document.querySelector<HTMLElement>("[role='dialog']")!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const labelledBy = dialog.getAttribute("aria-labelledby")!;
    expect(document.getElementById(labelledBy)?.textContent).toBe("Settings");

    act(() => document.querySelector<HTMLButtonElement>("[aria-label='Close']")!.click());
    act(() => (document.querySelector("[aria-hidden].fixed") as HTMLElement).click());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(3);
    unmount();
  });

  it("moves focus in on open and back to the opener on close", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(
      <Sheet open onClose={() => {}} title="Publish">
        Body
      </Sheet>,
    );
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close");
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("has no scrim and takes no focus when non-modal", () => {
    const { unmount } = render(
      <Sheet open modal={false} onClose={() => {}} title="Inspector" snap="peek" snaps={["peek", "half", "full"]}>
        Body
      </Sheet>,
    );
    const dialog = document.querySelector<HTMLElement>("[role='dialog']")!;
    expect(dialog.hasAttribute("aria-modal")).toBe(false);
    expect(document.querySelector("[aria-hidden].fixed")).toBeNull();
    expect(dialog.contains(document.activeElement)).toBe(false);
    unmount();
  });

  it("cycles snaps when the grabber is tapped", () => {
    const onSnapChange = vi.fn();
    const { unmount } = render(
      <Sheet
        open
        modal={false}
        onClose={() => {}}
        title="Inspector"
        snap="peek"
        snaps={["peek", "half", "full"]}
        onSnapChange={onSnapChange}
      >
        Body
      </Sheet>,
    );
    const handle = document.querySelector(".cursor-grab")!;
    pointer(handle, "pointerdown", { y: 500 });
    pointer(handle, "pointerup", { y: 500 });
    expect(onSnapChange).toHaveBeenCalledWith("half");
    unmount();
  });
});
