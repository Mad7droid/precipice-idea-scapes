import { act } from "react";
import type { Node, ReactFlowProps } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureScape } from "@/core/fixtures";
import { useScapeStore } from "@/core/store";
import { startAutosave } from "@/persistence/autosave";
import { MemoryScapeRepository } from "@/persistence/memoryRepository";
import { render, type Mounted } from "@/test/react";
import { Canvas } from "./Canvas";

// Exercise the callbacks wired by Canvas, with real document/undo/autosave code.
// React Flow owns pointer tracking and layout, which jsdom cannot measure.
const flow = vi.hoisted(() => ({ props: null as ReactFlowProps | null }));
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  ReactFlow: (props: ReactFlowProps) => {
    flow.props = props;
    return null;
  },
}));
vi.mock("./Toolbar", () => ({ Toolbar: () => null }));

const store = () => useScapeStore.getState();
const moved: Node[] = [
  { id: "brief", position: { x: 512.4, y: 256.6 }, data: {} },
  { id: "constraints", position: { x: 812.4, y: 456.6 }, data: {} },
];
let mounted: Mounted | undefined;

beforeEach(() => {
  store().loadScape(fixtureScape());
  flow.props = null;
});
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function stopDrag(nodes = moved) {
  act(() => flow.props!.onNodeDragStop!(new MouseEvent("mouseup"), nodes[0], nodes));
}

describe("canvas drag commits", () => {
  it("keeps every dragged block after autosave/reload and undoes/redoes the group together", async () => {
    const before = store().scape!;
    const repo = new MemoryScapeRepository();
    const autosave = startAutosave(repo);
    mounted = render(<Canvas />);
    try {
      stopDrag();
      expect(store().scape!.objects.brief).toMatchObject({ x: 512, y: 257 });
      expect(store().scape!.objects.constraints).toMatchObject({ x: 812, y: 457 });
      const untouched = before.objectOrder.filter((id) => !moved.some((n) => n.id === id));
      for (const id of untouched) expect(store().scape!.objects[id]).toBe(before.objects[id]);
      expect(store().undoStack).toHaveLength(1);
      expect(store().undoStack[0].size).toBe(2);
      expect(store().actionLog).toHaveLength(2);
      expect(new Set(store().actionLog.map((action) => action.txId)).size).toBe(1);
      await autosave.flush();
      const reloaded = await repo.get(before.id);
      expect(reloaded!.objects.brief).toMatchObject({ x: 512, y: 257 });
      expect(reloaded!.objects.constraints).toMatchObject({ x: 812, y: 457 });
      expect(autosave.writes()).toBe(1);

      act(() => {
        store().undo();
      });
      expect(store().scape!.objects).toEqual(before.objects);
      act(() => {
        store().redo();
      });
      expect(store().scape!.objects).toEqual(reloaded!.objects);
    } finally {
      autosave.stop();
    }
  });

  it("keeps drag frames local without recording document actions or saving snapshots", async () => {
    const before = store().scape!;
    const repo = new MemoryScapeRepository();
    const save = vi.spyOn(repo, "saveSnapshot");
    const autosave = startAutosave(repo);
    mounted = render(<Canvas />);
    try {
      for (let frame = 0; frame < 40; frame++) {
        act(() =>
          flow.props!.onNodesChange!(
            moved.map((node) => ({
              type: "position" as const,
              id: node.id,
              position: { x: node.position.x + frame, y: node.position.y + frame },
              dragging: true,
            })),
          ),
        );
      }
      await autosave.flush();
      expect(store().scape).toBe(before);
      expect(store().actionLog).toHaveLength(0);
      expect(store().undoStack).toHaveLength(0);
      expect(save).not.toHaveBeenCalled();
      stopDrag();
      await autosave.flush();
      expect(save).toHaveBeenCalledTimes(1);
      expect(store().actionLog).toHaveLength(0); // Drained by autosave.
      expect(store().undoStack).toHaveLength(1);
    } finally {
      autosave.stop();
    }
  });

  it("preserves single-block dragging", () => {
    mounted = render(<Canvas />);
    stopDrag([moved[0]]);
    expect(store().scape!.objects.brief).toMatchObject({ x: 512, y: 257 });
    expect(store().undoStack).toHaveLength(1);
    expect(store().undoStack[0].size).toBe(1);
  });

  it("does not add undo steps when a group ends at its original positions", () => {
    mounted = render(<Canvas />);
    const unchanged = moved.map((node) => ({
      ...node,
      position: { x: store().scape!.objects[node.id].x, y: store().scape!.objects[node.id].y },
    }));
    stopDrag(unchanged);
    expect(store().undoStack).toHaveLength(0);
    expect(store().actionLog).toHaveLength(0);
  });

  it("does not write a drag in a read-only window", () => {
    const before = store().scape;
    mounted = render(<Canvas readOnly />);
    stopDrag();
    expect(store().scape).toBe(before);
    expect(store().actionLog).toHaveLength(0);
    expect(store().undoStack).toHaveLength(0);
  });
});
