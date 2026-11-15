import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@/test/react";
import { allPlugins } from "@/core/registry";
import { AddBlockList, MobileActionBar } from "./MobileChrome";

const noop = () => {};

describe("MobileActionBar", () => {
  it("labels every action and disables undo and redo when there is nothing to do", () => {
    const { container, unmount } = render(
      <MobileActionBar
        onOutline={noop}
        onAdd={noop}
        onAsk={noop}
        onUndo={noop}
        onRedo={noop}
        canUndo={false}
        canRedo={false}
        readOnly={false}
      />,
    );
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Outline", "Add", "Ask", "Undo", "Redo"]);
    expect(buttons[3].disabled).toBe(true);
    expect(buttons[4].disabled).toBe(true);
    unmount();
  });

  it("hides the editing actions in a read-only tab", () => {
    const { container, unmount } = render(
      <MobileActionBar
        onOutline={noop}
        onAdd={noop}
        onAsk={noop}
        onUndo={noop}
        onRedo={noop}
        canUndo
        canRedo
        readOnly
      />,
    );
    const labels = [...container.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toEqual(["Outline", "Undo", "Redo"]);
    unmount();
  });

  it("undoes from the bar", () => {
    const onUndo = vi.fn();
    const { container, unmount } = render(
      <MobileActionBar
        onOutline={noop}
        onAdd={noop}
        onAsk={noop}
        onUndo={onUndo}
        onRedo={noop}
        canUndo
        canRedo={false}
        readOnly={false}
      />,
    );
    act(() => [...container.querySelectorAll("button")][3].click());
    expect(onUndo).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe("AddBlockList", () => {
  it("offers every registered block type", () => {
    const onAdd = vi.fn();
    const { container, unmount } = render(<AddBlockList onAdd={onAdd} />);
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons).toHaveLength(allPlugins().length);
    act(() => buttons[0].click());
    expect(onAdd).toHaveBeenCalledWith(allPlugins()[0].type);
    unmount();
  });
});
