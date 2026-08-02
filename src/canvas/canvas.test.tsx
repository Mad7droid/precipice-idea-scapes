import { ReactFlowProvider } from "@xyflow/react";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyScape, fixtureScape } from "@/core/fixtures";
import { useScapeStore } from "@/core/store";
import type { Scape } from "@/core/types";
import { render } from "@/test/react";
import { mergeFlowNodes, toFlowEdges, toFlowNodes } from "./edges";
import { layoutAction, layoutPositions, objectWidth, widthFor } from "./layout";
import { ObjectNode } from "./ObjectNode";

const store = () => useScapeStore.getState();

beforeEach(() => store().loadScape(fixtureScape()));

describe("layout", () => {
  it("produces no overlapping nodes for the fixture", () => {
    const scape = fixtureScape();
    const positions = layoutPositions(scape, "LR");
    const heights: Record<string, number> = { note: 116, journey: 168, wireframe: 190 };

    const boxes = Object.entries(positions).map(([id, p]) => ({
      id,
      x1: p.x,
      y1: p.y,
      x2: p.x + objectWidth(scape.objects[id]),
      y2: p.y + (heights[scape.objects[id].type] ?? 130),
    }));

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlaps = a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
        expect(overlaps, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it("places every object", () => {
    const scape = fixtureScape();
    expect(Object.keys(layoutPositions(scape)).sort()).toEqual([...scape.objectOrder].sort());
  });

  it("survives a relationship pointing at a missing object", () => {
    const scape = fixtureScape();
    scape.relationships["dangling"] = { id: "dangling", from: "brief", to: "ghost" };
    expect(() => layoutPositions(scape)).not.toThrow();
  });

  it("is a single action and therefore a single undo", () => {
    const before = structuredClone(store().scape!);
    store().dispatchTx([layoutAction(before, "LR")]);

    expect(store().undoStack).toHaveLength(1);
    expect(store().undoStack[0].size).toBe(1);
    // Positions actually moved.
    expect(store().scape!.objects["brief"]).not.toEqual(before.objects["brief"]);

    store().undo();
    expect({ ...store().scape!, updatedAt: 0 }).toEqual({ ...before, updatedAt: 0 });
  });
});

describe("edges derive from relationships", () => {
  it("matches relationships exactly", () => {
    const scape = store().scape!;
    const edges = toFlowEdges(scape, []);
    expect(edges.map((e) => e.id).sort()).toEqual(Object.keys(scape.relationships).sort());
    for (const edge of edges) {
      const rel = scape.relationships[edge.id];
      expect([edge.source, edge.target]).toEqual([rel.from, rel.to]);
    }
  });

  it("matches after an edge is added", () => {
    store().dispatchTx([
      { type: "ConnectObjects", id: "r-new", from: "brief", to: "wf-fund", label: "informs" },
    ]);
    const scape = store().scape!;
    const edges = toFlowEdges(scape, []);
    expect(edges.map((e) => e.id).sort()).toEqual(Object.keys(scape.relationships).sort());
    // Labels ride on the edges currently being asked about, not on all of them at once —
    // every label drawn at all times is the single densest thing on a busy canvas.
    expect(edges.find((e) => e.id === "r-new")?.label).toBeUndefined();
    expect(toFlowEdges(scape, ["brief"]).find((e) => e.id === "r-new")?.label).toBe("informs");
  });

  it("matches after an edge is removed", () => {
    store().dispatchTx([{ type: "DisconnectObjects", id: "r-brief-happy" }]);
    const scape = store().scape!;
    const edges = toFlowEdges(scape, []);
    expect(edges.map((e) => e.id)).not.toContain("r-brief-happy");
    expect(edges.map((e) => e.id).sort()).toEqual(Object.keys(scape.relationships).sort());
  });

  it("draws nothing in `none` mode, and only the selection's edges in `selected`", () => {
    const scape = store().scape!;
    expect(toFlowEdges(scape, [], "none")).toEqual([]);
    expect(toFlowEdges(scape, ["brief"], "none")).toEqual([]);

    const focused = toFlowEdges(scape, ["brief"], "selected");
    expect(focused.length).toBeGreaterThan(0);
    for (const edge of focused) {
      expect([edge.source, edge.target]).toContain("brief");
    }
    expect(focused.length).toBeLessThan(toFlowEdges(scape, ["brief"], "all").length);
  });

  it("drops edges attached to a hidden object type", () => {
    const scape = store().scape!;
    const hidden = toFlowEdges(scape, [], "all", new Set(["wireframe"]));
    for (const edge of hidden) {
      expect(scape.objects[edge.source].type).not.toBe("wireframe");
      expect(scape.objects[edge.target].type).not.toBe("wireframe");
    }
    expect(hidden.length).toBeLessThan(toFlowEdges(scape, [], "all").length);
  });

  it("drops edges whose endpoints no longer exist rather than rendering a dangling line", () => {
    const scape: Scape = structuredClone(store().scape!);
    scape.relationships["dangling"] = { id: "dangling", from: "brief", to: "ghost" };
    expect(toFlowEdges(scape, []).map((e) => e.id)).not.toContain("dangling");
  });

  it("thickens an edge when either endpoint is selected", () => {
    const scape = store().scape!;
    const [plain] = toFlowEdges(scape, []).filter((e) => e.id === "r-brief-happy");
    const [active] = toFlowEdges(scape, ["brief"]).filter((e) => e.id === "r-brief-happy");
    expect(plain.style?.strokeWidth).toBe(1.5);
    expect(active.style?.strokeWidth).toBe(2);
  });
});

describe("nodes", () => {
  it("preserves ScapeObject identity, so memoized nodes do not re-render on unrelated changes", () => {
    const scape = store().scape!;
    const before = toFlowNodes(scape, []);

    store().dispatchTx([{ type: "MoveObject", id: "brief", x: 999, y: 999 }]);
    const after = toFlowNodes(store().scape!, []);

    const untouched = (nodes: ReturnType<typeof toFlowNodes>, id: string) =>
      nodes.find((n) => n.id === id)!.data.object;

    // The moved object is a new reference; every other object is the same one.
    expect(untouched(after, "brief")).not.toBe(untouched(before, "brief"));
    expect(untouched(after, "constraints")).toBe(untouched(before, "constraints"));
  });
});

describe("mergeFlowNodes", () => {
  /**
   * Regression: rebuilding the mirror from scratch drops React Flow's `measured` field, and
   * React Flow then silently removes every edge whose endpoints have no measured handles —
   * so the entire graph loses its edges the moment anything changes.
   */
  it("preserves React Flow's measured dimensions across a Scape change", () => {
    const scape = store().scape!;
    const measured = toFlowNodes(scape, []).map((n) => ({
      ...n,
      measured: { width: 220, height: 140 },
    }));

    store().dispatchTx([{ type: "MoveObject", id: "brief", x: 400, y: 400 }]);
    const merged = mergeFlowNodes(measured, store().scape!);

    for (const node of merged) {
      expect(node.measured, node.id).toEqual({ width: 220, height: 140 });
    }
    expect(merged.find((n) => n.id === "brief")!.position).toEqual({ x: 400, y: 400 });
  });

  it("returns the identical node object when nothing about it changed", () => {
    const scape = store().scape!;
    const before = toFlowNodes(scape, []);

    store().dispatchTx([{ type: "MoveObject", id: "brief", x: 400, y: 400 }]);
    const merged = mergeFlowNodes(before, store().scape!);

    const find = (nodes: typeof before, id: string) => nodes.find((n) => n.id === id)!;
    expect(find(merged, "constraints")).toBe(find(before, "constraints"));
    expect(find(merged, "brief")).not.toBe(find(before, "brief"));
  });

  it("keeps React Flow's selection, which React Flow owns", () => {
    const scape = store().scape!;
    const withSelection = toFlowNodes(scape, []).map((n) =>
      n.id === "brief" ? { ...n, selected: true } : n,
    );

    store().dispatchTx([{ type: "MoveObject", id: "constraints", x: 10, y: 10 }]);
    const merged = mergeFlowNodes(withSelection, store().scape!);

    expect(merged.find((n) => n.id === "brief")!.selected).toBe(true);
  });

  it("adds nodes created since the last merge and drops deleted ones", () => {
    const before = toFlowNodes(store().scape!, []);

    store().dispatchTx([
      { type: "CreateObject", id: "fresh", objectType: "note", title: "Fresh" },
      { type: "DeleteObject", id: "brief" },
    ]);
    const merged = mergeFlowNodes(before, store().scape!);

    expect(merged.map((n) => n.id)).toContain("fresh");
    expect(merged.map((n) => n.id)).not.toContain("brief");
  });
});

describe("drag", () => {
  it("emits exactly one MoveObject carrying the correct before and after", () => {
    const before = store().scape!.objects["brief"];
    store().drainActionLog();

    // What Canvas dispatches from onNodeDragStop — one action, at drag end, never per frame.
    store().dispatchTx([{ type: "MoveObject", id: "brief", x: 512, y: 256 }]);

    const log = store().drainActionLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ type: "MoveObject", id: "brief", x: 512, y: 256 });

    expect(store().undoStack).toHaveLength(1);
    expect(store().undoStack[0].inverses[0]).toMatchObject({
      type: "MoveObject",
      id: "brief",
      x: before.x,
      y: before.y,
    });
  });
});

describe("unregistered object types", () => {
  it("render a fallback card naming the type, rather than throwing or rendering blank", () => {
    const scape = emptyScape("scp_t");
    const object = {
      id: "unknown-1",
      // A type this build has never heard of — e.g. a .scape from a newer version.
      type: "persona",
      title: "Someone",
      data: {},
      x: 0,
      y: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    scape.objects[object.id] = object;

    const { container, unmount } = render(
      <ReactFlowProvider>
        <ObjectNode
          id={object.id}
          type="object"
          data={{ object }}
          selected={false}
          dragging={false}
          zIndex={0}
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          deletable
          selectable
          draggable
        />
      </ReactFlowProvider>,
    );

    expect(container.textContent).toContain("persona");
    expect(container.textContent).toContain("Someone");
    unmount();
  });
});

describe("card width", () => {
  it("falls back to the type's default when nothing has been dragged", () => {
    const object = { type: "wireframe", data: {} };
    expect(objectWidth(object)).toBe(widthFor("wireframe"));
    expect(objectWidth({ type: "note", data: {} })).toBe(widthFor("note"));
  });

  it("prefers a width stored on the object, clamped to what a card can be", () => {
    expect(objectWidth({ type: "note", data: { width: 460 } })).toBe(460);
    expect(objectWidth({ type: "note", data: { width: 5 } })).toBe(200);
    expect(objectWidth({ type: "note", data: { width: 5000 } })).toBe(900);
    // A width that is not a number is not a width.
    expect(objectWidth({ type: "note", data: { width: "wide" } })).toBe(widthFor("note"));
  });

  it("lays out a resized card at the width it was dragged to", () => {
    const scape = fixtureScape();
    const [first] = scape.objectOrder;
    const widened: Scape = {
      ...scape,
      objects: {
        ...scape.objects,
        [first]: { ...scape.objects[first], data: { ...scape.objects[first].data, width: 880 } },
      },
    };
    const before = layoutPositions(scape, "LR");
    const after = layoutPositions(widened, "LR");
    // Dagre reserves the extra room, so at least one downstream node has to move.
    expect(after).not.toEqual(before);
  });
});
