import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyScape } from "@/core/fixtures";
import { useScapeStore } from "@/core/store";
import type { Scape, ThemePreference } from "@/core/types";
import { render, type as typeInto, type Mounted } from "@/test/react";
import { BlockMarkers } from "../BlockMarkers";
import { ThemeControl } from "../ThemeControl";
import { readHiddenTypes, viewportShowsContent, visibleObjectIds } from "./layout";
import { PanelResizer } from "./PanelResizer";
import { useEditorShortcuts, type EditorShortcutHandlers } from "./useEditorShortcuts";

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  localStorage.clear();
});

function withObjects(): Scape {
  const scape = emptyScape("scp_layout", "Fictional layout");
  const base = { data: {}, createdAt: 0, updatedAt: 0 };
  scape.objects = {
    a: { ...base, id: "a", type: "note", title: "A", x: 0, y: 0 },
    b: { ...base, id: "b", type: "wireframe", title: "B", x: 2000, y: 2000 },
  };
  scape.objectOrder = ["a", "b"];
  return scape;
}

describe("viewportShowsContent", () => {
  it("is true when any block lands inside the canvas", () => {
    expect(viewportShowsContent(withObjects(), { x: 0, y: 0, zoom: 1 }, 800, 600)).toBe(true);
  });
  it("is false when a saved viewport puts every block off-screen", () => {
    expect(viewportShowsContent(withObjects(), { x: -5000, y: -5000, zoom: 1 }, 800, 600)).toBe(
      false,
    );
  });
  it("treats an empty scape as fine", () => {
    expect(
      viewportShowsContent(emptyScape("e", "Empty"), { x: -9e5, y: 0, zoom: 1 }, 800, 600),
    ).toBe(true);
  });
});

describe("visibleObjectIds", () => {
  it("leaves hidden types out of select-all", () => {
    localStorage.setItem("precipice.view.hiddenTypes", JSON.stringify(["wireframe"]));
    expect(readHiddenTypes()).toEqual(new Set(["wireframe"]));
    expect(visibleObjectIds(withObjects())).toEqual(["a"]);
  });
});

function Shortcuts(props: EditorShortcutHandlers) {
  useEditorShortcuts(props);
  return null;
}

describe("useEditorShortcuts", () => {
  const undo = vi.fn();
  const redo = vi.fn();
  beforeEach(() => {
    undo.mockReset();
    redo.mockReset();
    useScapeStore.setState({ undo, redo });
  });
  const handlers = (over: Partial<EditorShortcutHandlers> = {}): EditorShortcutHandlers => ({
    openCommands: vi.fn(),
    toggleScapi: vi.fn(),
    togglePanels: vi.fn(),
    openHelp: vi.fn(),
    scapiOpen: false,
    closeScapi: vi.fn(),
    readOnly: false,
    busy: false,
    ...over,
  });
  const press = (key: string, init: KeyboardEventInit = {}) =>
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init })));

  it("undoes and redoes when idle", () => {
    mounted = render(<Shortcuts {...handlers()} />);
    press("z", { metaKey: true });
    press("z", { metaKey: true, shiftKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it("ignores undo and redo while a generation is streaming", () => {
    mounted = render(<Shortcuts {...handlers({ busy: true })} />);
    press("z", { metaKey: true });
    press("z", { metaKey: true, shiftKey: true });
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });

  it("ignores undo in a read-only tab", () => {
    mounted = render(<Shortcuts {...handlers({ readOnly: true })} />);
    press("z", { metaKey: true });
    expect(undo).not.toHaveBeenCalled();
  });

  it("opens the palette and help", () => {
    const h = handlers();
    mounted = render(<Shortcuts {...h} />);
    press("k", { metaKey: true });
    press("?");
    expect(h.openCommands).toHaveBeenCalled();
    expect(h.openHelp).toHaveBeenCalled();
  });
});

describe("PanelResizer", () => {
  it("is a focusable separator that resizes with arrow keys within limits", () => {
    const onResize = vi.fn();
    mounted = render(
      <PanelResizer side="left" label="Resize outline" width={280} onResize={onResize} />,
    );
    const sep = mounted.container.querySelector<HTMLElement>("[role='separator']")!;
    expect(sep.tabIndex).toBe(0);
    expect(sep.getAttribute("aria-valuenow")).toBe("280");
    act(() =>
      sep.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    expect(onResize).toHaveBeenLastCalledWith(296);
    act(() => sep.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(onResize).toHaveBeenLastCalledWith(440);
  });

  it("grows the right panel leftwards", () => {
    const onResize = vi.fn();
    mounted = render(
      <PanelResizer side="right" label="Resize inspector" width={320} onResize={onResize} />,
    );
    const sep = mounted.container.querySelector<HTMLElement>("[role='separator']")!;
    act(() => sep.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(onResize).toHaveBeenLastCalledWith(336);
  });
});

describe("ThemeControl", () => {
  it("is one tab stop and moves with arrow keys", () => {
    const onChange = vi.fn<(next: ThemePreference) => void>();
    mounted = render(<ThemeControl value="light" onChange={onChange} />);
    const radios = [...mounted.container.querySelectorAll<HTMLElement>("[role='radio']")];
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    act(() =>
      radios[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    expect(onChange).toHaveBeenLastCalledWith("dark");
    act(() =>
      radios[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })),
    );
    expect(onChange).toHaveBeenLastCalledWith("system");
  });
});

describe("BlockMarkers tag input", () => {
  const object = withObjects().objects.a;
  const input = () => mounted!.container.querySelector<HTMLInputElement>("input")!;

  it("does not commit a half-typed tag on blur", () => {
    const dispatch = vi.fn();
    mounted = render(<BlockMarkers object={object} dispatch={dispatch} suggestions={[]} />);
    typeInto(input(), "draft");
    act(() => input().dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(dispatch).not.toHaveBeenCalled();
    expect(input().value).toBe("");
  });

  it("discards the draft on Escape", () => {
    const dispatch = vi.fn();
    mounted = render(<BlockMarkers object={object} dispatch={dispatch} suggestions={[]} />);
    typeInto(input(), "draft");
    act(() =>
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(dispatch).not.toHaveBeenCalled();
    expect(input().value).toBe("");
  });

  it("still commits on Enter", () => {
    const dispatch = vi.fn();
    mounted = render(<BlockMarkers object={object} dispatch={dispatch} suggestions={[]} />);
    typeInto(input(), "fictional");
    act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(dispatch).toHaveBeenCalledWith({
      type: "UpdateObject",
      id: "a",
      patch: { tags: ["fictional"] },
    });
  });
});
