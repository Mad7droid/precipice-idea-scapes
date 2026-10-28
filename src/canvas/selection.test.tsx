import { act } from "react";
import type { ReactFlowProps } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Outline } from "@/app/Outline";
import { fixtureScape } from "@/core/fixtures";
import { useScapeStore } from "@/core/store";
import { render, type Mounted } from "@/test/react";
import { Canvas } from "./Canvas";

const flow = vi.hoisted(() => ({ props: null as ReactFlowProps | null, real: false }));
vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    ReactFlow: (props: ReactFlowProps) => {
      flow.props = props;
      return flow.real ? <actual.ReactFlow {...props} /> : null;
    },
  };
});
vi.mock("./Toolbar", () => ({ Toolbar: () => null }));

const store = () => useScapeStore.getState();
const highlighted = () => flow.props!.nodes!.filter((node) => node.selected).map((node) => node.id);
let mounted: Mounted | undefined;

beforeEach(() => {
  const scape = fixtureScape();
  // Deterministic spatial navigation independent of the fixture's layout.
  scape.objects.brief = { ...scape.objects.brief, x: 0, y: 0 };
  scape.objects.constraints = { ...scape.objects.constraints, x: 10, y: 0 };
  store().loadScape(scape);
  flow.props = null;
  flow.real = false;
});
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function key(key: string, options: KeyboardEventInit = {}) {
  act(() =>
    mounted!.container
      .querySelector<HTMLElement>("[tabindex='0']")!
      .dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...options })),
  );
}

function WithOutline() {
  const scape = useScapeStore((state) => state.scape)!;
  const selection = useScapeStore((state) => state.selection);
  return (
    <>
      <Outline
        scape={scape}
        selection={selection}
        onSelect={(id) => store().setSelection([id])}
        onConnectLoose={() => {}}
        busy={false}
      />
      <Canvas />
    </>
  );
}

describe("selection highlights follow document selection", () => {
  it("keeps real React Flow highlights in sync through mount, pointer clicks, and external changes", () => {
    flow.real = true;
    store().setSelection(["brief"]);
    mounted = render(<Canvas />);
    const selectedIds = () =>
      [...mounted!.container.querySelectorAll<HTMLElement>(".react-flow__node.selected")].map(
        (element) => element.dataset.id,
      );
    expect(store().selection).toEqual(["brief"]);
    expect(selectedIds()).toEqual(["brief"]);
    const target = mounted.container.querySelector<HTMLElement>(
      ".react-flow__node[data-id='constraints']",
    )!;
    act(() => target.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(store().selection).toEqual(["constraints"]);
    expect(selectedIds()).toEqual(["constraints"]);
    act(() => store().setSelection(["brief"]));
    expect(selectedIds()).toEqual(["brief"]);
    key("Delete");
    expect(store().scape!.objects.brief).toBeUndefined();
    expect(store().scape!.objects.constraints).toBeDefined();
    expect(selectedIds()).toEqual([]);
  });

  it("highlights the outline choice and Delete removes that block, leaving the old choice intact", () => {
    store().setSelection(["brief"]);
    mounted = render(<WithOutline />);
    expect(highlighted()).toEqual(["brief"]);
    const target = [...mounted.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) =>
        button.querySelector("span.truncate")?.textContent ===
        store().scape!.objects.constraints.title,
    )!;
    expect(target).toBeDefined();
    act(() => target.click());
    expect(store().selection).toEqual(["constraints"]);
    expect(highlighted()).toEqual(["constraints"]);
    key("Delete");
    expect(store().scape!.objects.constraints).toBeUndefined();
    expect(store().scape!.objects.brief).toBeDefined();
    expect(highlighted()).toEqual([]);
  });

  it("moves the highlight with Alt+Arrow and deletes the newly highlighted block", () => {
    store().setSelection(["brief"]);
    mounted = render(<Canvas />);
    key("ArrowRight", { altKey: true });
    expect(store().selection).toEqual(["constraints"]);
    expect(highlighted()).toEqual(["constraints"]);
    key("Backspace");
    expect(store().scape!.objects.constraints).toBeUndefined();
    expect(store().scape!.objects.brief).toBeDefined();
  });

  it("reflects select-all commands, then Escape clears all highlights without recording edits", () => {
    mounted = render(<Canvas />);
    const before = store().scape;
    // The editor's select-all command writes this same store selection.
    act(() => store().setSelection([...store().scape!.objectOrder]));
    expect(highlighted()).toEqual(store().scape!.objectOrder);
    key("Escape");
    expect(store().selection).toEqual([]);
    expect(highlighted()).toEqual([]);
    expect(store().scape).toBe(before);
    expect(store().actionLog).toHaveLength(0);
    expect(store().undoStack).toHaveLength(0);
  });

  it("keeps pointer selection working in both directions", () => {
    mounted = render(<Canvas />);
    const select = (id: string) => {
      act(() => {
        flow.props!.onNodesChange!([{ type: "select", id, selected: true }]);
      });
    };
    select("brief");
    expect(store().selection).toEqual(["brief"]);
    expect(highlighted()).toEqual(["brief"]);
    act(() => store().setSelection(["constraints"]));
    expect(highlighted()).toEqual(["constraints"]);
  });

  it("updates only changed selection flags and preserves live drag positions and node measurements", () => {
    mounted = render(<Canvas />);
    act(() =>
      flow.props!.onNodesChange!([
        { type: "position", id: "brief", position: { x: 543, y: 321 }, dragging: true },
        { type: "dimensions", id: "brief", dimensions: { width: 220, height: 140 } },
      ]),
    );
    const before = flow.props!.nodes!;
    const unchanged = before.find((node) => node.id === "happy-path")!;
    act(() => store().setSelection(["brief"]));
    const selected = flow.props!.nodes!.find((node) => node.id === "brief")!;
    expect(selected.selected).toBe(true);
    expect(selected.position).toEqual({ x: 543, y: 321 });
    expect(selected.measured).toEqual({ width: 220, height: 140 });
    expect(flow.props!.nodes!.find((node) => node.id === unchanged.id)).toBe(unchanged);
    const selectedNodes = flow.props!.nodes;
    act(() => store().setSelection(["brief"]));
    expect(flow.props!.nodes).toBe(selectedNodes);
    expect(store().actionLog).toHaveLength(0);
  });

  it("clears an old edge selection when a command selects a block", () => {
    const edgeSelection = vi.fn();
    mounted = render(<Canvas onEdgeSelect={edgeSelection} />);
    const edge = flow.props!.edges!.find((edge) => edge.id === "r-brief-happy")!;
    act(() => flow.props!.onEdgeClick!({ stopPropagation() {} } as never, edge));
    expect(edgeSelection).toHaveBeenLastCalledWith(edge.id);
    act(() => store().setSelection(["constraints"]));
    expect(edgeSelection).toHaveBeenLastCalledWith(null);
    expect(highlighted()).toEqual(["constraints"]);
    key("Delete");
    expect(store().scape!.objects.constraints).toBeUndefined();
    expect(store().scape!.relationships[edge.id]).toBeDefined();
  });

  it("reflects external selection in read-only mode without allowing Delete", () => {
    mounted = render(<Canvas readOnly />);
    const before = store().scape;
    act(() => store().setSelection(["constraints"]));
    expect(highlighted()).toEqual(["constraints"]);
    key("Delete");
    expect(store().scape).toBe(before);
    expect(store().actionLog).toHaveLength(0);
  });

  it("does not overwrite the primary selection when React Flow reports the same members in canvas order", () => {
    mounted = render(<Canvas />);
    act(() => store().setSelection(["constraints", "brief"]));
    const selection = store().selection;
    act(() =>
      flow.props!.onNodesChange!([
        { type: "select", id: "brief", selected: true },
        { type: "select", id: "constraints", selected: true },
      ]),
    );
    expect(store().selection).toBe(selection);
    expect(store().selection[0]).toBe("constraints");
  });
});

describe("canvas keyboard", () => {
  const count = () => store().scape!.objectOrder.length;

  it("lets Tab leave the canvas and extends the selection with E instead", () => {
    mounted = render(<Canvas />);
    act(() => store().setSelection(["brief"]));
    const before = count();
    key("Tab");
    expect(count()).toBe(before);
    key("e");
    expect(count()).toBe(before + 1);
  });

  it("leaves letters typed straight after a node double-click to the opening editor", () => {
    mounted = render(<Canvas />);
    act(() => store().setSelection(["brief"]));
    const node = flow.props!.nodes!.find((n) => n.id === "brief")!;
    act(() => flow.props!.onNodeDoubleClick!({} as React.MouseEvent, node));
    const before = count();
    key("n");
    key("e");
    expect(count()).toBe(before);
  });

  it("refuses drags and nudges while a generation is streaming", () => {
    mounted = render(<Canvas isGenerating />);
    expect(flow.props!.nodesDraggable).toBe(false);
    act(() => store().setSelection(["brief"]));
    const x = store().scape!.objects.brief.x;
    key("ArrowRight");
    expect(store().scape!.objects.brief.x).toBe(x);
  });
});

describe("connection drops", () => {
  it("dropping a connection on a card body connects to that card", () => {
    mounted = render(<Canvas />);
    const before = Object.keys(store().scape!.relationships).length;
    act(() =>
      flow.props!.onConnectEnd!(new MouseEvent("mouseup", { clientX: 5, clientY: 5 }), {
        isValid: false,
        fromNode: { id: "constraints" },
        toNode: { id: "brief" },
      } as never),
    );
    const rels = Object.values(store().scape!.relationships);
    expect(rels.length).toBe(before + 1);
    expect(rels.some((r) => r.from === "constraints" && r.to === "brief")).toBe(true);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});
