import { describe, expect, it } from "vitest";
import { emptyScape, fixtureScape } from "@/core/fixtures";
import type { ObjectId, Scape } from "@/core/types";
import { gridPositions, radialPositions } from "./arrange";
import { layoutPositions, objectWidth } from "./layout";

const HEIGHTS: Record<string, number> = { note: 116, journey: 168, wireframe: 190 };

const sizeOf = (scape: Scape) => (id: ObjectId) => ({
  width: objectWidth(scape.objects[id]!),
  height: HEIGHTS[scape.objects[id]!.type] ?? 130,
});

function overlappingPair(scape: Scape, positions: Record<string, { x: number; y: number }>) {
  const size = sizeOf(scape);
  const boxes = Object.entries(positions).map(([id, p]) => {
    const s = size(id);
    return { id, x1: p.x, y1: p.y, x2: p.x + s.width, y2: p.y + s.height };
  });
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) return `${a.id} / ${b.id}`;
    }
  }
  return null;
}

describe("radial layout", () => {
  it("places every object without overlapping any other", () => {
    const scape = fixtureScape();
    const positions = radialPositions(scape, sizeOf(scape));
    expect(Object.keys(positions).sort()).toEqual([...scape.objectOrder].sort());
    expect(overlappingPair(scape, positions)).toBeNull();
  });

  it("puts the most connected object in the middle", () => {
    const scape = fixtureScape();
    const positions = radialPositions(scape, sizeOf(scape));
    const size = sizeOf(scape);

    const centreOf = (id: string) => ({
      x: positions[id].x + size(id).width / 2,
      y: positions[id].y + size(id).height / 2,
    });

    // "happy-path" has six incident relationships in the fixture; nothing else comes close.
    const hub = centreOf("happy-path");
    const distances = scape.objectOrder
      .filter((id) => id !== "happy-path")
      .map((id) => {
        const c = centreOf(id);
        return Math.hypot(c.x - hub.x, c.y - hub.y);
      });
    // Every other object sits on a ring outside it, so all of them are strictly further out
    // than the hub is from itself.
    expect(Math.min(...distances)).toBeGreaterThan(0);

    // And the hub really is the centroid, not merely first: the average position of everything
    // else should land near it rather than off to one side.
    const others = scape.objectOrder.filter((id) => id !== "happy-path").map(centreOf);
    const mean = {
      x: others.reduce((s, c) => s + c.x, 0) / others.length,
      y: others.reduce((s, c) => s + c.y, 0) / others.length,
    };
    const spread = Math.max(...distances);
    expect(Math.hypot(mean.x - hub.x, mean.y - hub.y)).toBeLessThan(spread * 0.5);
  });

  it("is deterministic", () => {
    const a = radialPositions(fixtureScape(), sizeOf(fixtureScape()));
    const b = radialPositions(fixtureScape(), sizeOf(fixtureScape()));
    expect(a).toEqual(b);
  });

  it("still places an object the root cannot reach", () => {
    const scape = fixtureScape();
    scape.objects["island"] = {
      id: "island",
      type: "note",
      title: "Unconnected",
      data: { body: "" },
      x: 0,
      y: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    scape.objectOrder.push("island");

    const positions = radialPositions(scape, sizeOf(scape));
    expect(positions["island"]).toBeDefined();
    expect(overlappingPair(scape, positions)).toBeNull();
  });

  it("handles a scape with one object, and with none", () => {
    const one = emptyScape("scp_one");
    one.objects["solo"] = {
      id: "solo",
      type: "note",
      title: "Solo",
      data: { body: "" },
      x: 0,
      y: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    one.objectOrder.push("solo");

    expect(Object.keys(radialPositions(one, sizeOf(one)))).toEqual(["solo"]);
    expect(radialPositions(emptyScape("scp_none"), () => ({ width: 1, height: 1 }))).toEqual({});
  });
});

describe("grid layout", () => {
  it("places every object without overlapping any other", () => {
    const scape = fixtureScape();
    const positions = gridPositions(scape, sizeOf(scape));
    expect(Object.keys(positions).sort()).toEqual([...scape.objectOrder].sort());
    expect(overlappingPair(scape, positions)).toBeNull();
  });

  it("groups objects of the same type together", () => {
    const scape = fixtureScape();
    const positions = gridPositions(scape, sizeOf(scape));

    // Reading order: top to bottom, then left to right within a row.
    const order = [...scape.objectOrder].sort((a, b) => {
      const pa = positions[a];
      const pb = positions[b];
      return pa.y !== pb.y ? pa.y - pb.y : pa.x - pb.x;
    });

    const types = order.map((id) => scape.objects[id]!.type);
    // Each type appears as one contiguous run.
    const runs = types.filter((t, i) => t !== types[i - 1]);
    expect(runs.length).toBe(new Set(types).size);
  });

  it("is empty for an empty scape", () => {
    expect(gridPositions(emptyScape("scp_none"), () => ({ width: 1, height: 1 }))).toEqual({});
  });
});

describe("layoutPositions dispatches on mode", () => {
  it("routes each mode to a different arrangement", () => {
    const scape = fixtureScape();
    const lr = layoutPositions(scape, "LR");
    const tb = layoutPositions(scape, "TB");
    const radial = layoutPositions(scape, "radial");
    const grid = layoutPositions(scape, "grid");

    expect(lr).not.toEqual(tb);
    expect(radial).not.toEqual(lr);
    expect(grid).not.toEqual(radial);
    for (const positions of [lr, tb, radial, grid]) {
      expect(Object.keys(positions).sort()).toEqual([...scape.objectOrder].sort());
    }
  });

  it("defaults to the left-to-right flow, which is what it always did", () => {
    const scape = fixtureScape();
    expect(layoutPositions(scape)).toEqual(layoutPositions(scape, "LR"));
  });
});
