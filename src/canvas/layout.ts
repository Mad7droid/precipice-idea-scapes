import dagre from "dagre";
import type { ActionPayload } from "@/core/actions";
import type { ObjectId, Scape } from "@/core/types";
import type { LayoutMode } from "@/starters";
import { gridPositions, radialPositions, type NodeSize, type Positions } from "./arrange";

/**
 * Auto-layout. This is the only place in the app that decides where an object sits.
 *
 * The model never emits coordinates — `CreateObject` has no x/y — so every newly created
 * object arrives at the origin and this runs to place it.
 *
 * Which arrangement runs is the scape's starter's decision: a journey map is a layered graph
 * and belongs to Dagre, a mind map is a tree around a centre and does not.
 */

/**
 * Card geometry lives in `@/core/geometry` and is re-exported here so existing callers keep
 * importing it from the canvas. It had to move: the public viewer draws cards at the same
 * widths, and it cannot import this file because Dagre comes with it.
 */
export {
  MAX_OBJECT_WIDTH,
  MIN_OBJECT_WIDTH,
  NODE_WIDTH,
  objectWidth,
  widthFor,
} from "@/core/geometry";

import { NODE_WIDTH, objectWidth } from "@/core/geometry";

/**
 * Fallback heights, used before React Flow has measured a node — which is always the case
 * for objects that were created moments ago by a streaming generation.
 */
const FALLBACK_HEIGHT: Record<string, number> = {
  note: 116,
  journey: 168,
  wireframe: 190,
  scape: 220,
};
const DEFAULT_HEIGHT = 130;

/** Retained name for the two Dagre rank directions. `LayoutMode` is the full set. */
export type Direction = Extract<LayoutMode, "LR" | "TB">;

export type { NodeSize } from "./arrange";

/** The size a node will actually be drawn at: measured if React Flow has seen it, else a guess. */
function sizeLookup(scape: Scape, measured: Record<ObjectId, NodeSize>) {
  return (id: ObjectId): NodeSize => {
    const fromFlow = measured[id];
    if (fromFlow) return fromFlow;
    const object = scape.objects[id];
    return {
      width: object ? objectWidth(object) : NODE_WIDTH,
      height: (object && FALLBACK_HEIGHT[object.type]) ?? DEFAULT_HEIGHT,
    };
  };
}

export function layoutPositions(
  scape: Scape,
  mode: LayoutMode = "LR",
  measured: Record<ObjectId, NodeSize> = {},
): Positions {
  if (mode === "radial") return radialPositions(scape, sizeLookup(scape, measured));
  if (mode === "grid") return gridPositions(scape, sizeLookup(scape, measured));
  return dagrePositions(scape, mode, measured);
}

function dagrePositions(
  scape: Scape,
  direction: Direction,
  measured: Record<ObjectId, NodeSize>,
): Positions {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: direction,
    // Loose on purpose. The earlier, tighter numbers fit more on screen but produced a wall
    // of cards with edges threading between them, which is the state people describe as
    // "cluttered" — the cost of scrolling is much lower than the cost of not being able to
    // read the thing at all.
    nodesep: 72,
    ranksep: 160,
    marginx: 48,
    marginy: 48,
    // Fewer edge crossings than the default network-simplex on the wide, shallow graphs
    // this app tends to produce.
    ranker: "tight-tree",
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const id of scape.objectOrder) {
    const object = scape.objects[id];
    if (!object) continue;
    const size = measured[id];
    graph.setNode(id, {
      width: size?.width ?? objectWidth(object),
      height: size?.height ?? FALLBACK_HEIGHT[object.type] ?? DEFAULT_HEIGHT,
    });
  }

  for (const rel of Object.values(scape.relationships)) {
    // Dagre throws on an edge to a node it does not know about.
    if (!scape.objects[rel.from] || !scape.objects[rel.to]) continue;
    graph.setEdge(rel.from, rel.to);
  }

  dagre.layout(graph);

  const positions: Positions = {};
  for (const id of scape.objectOrder) {
    const node = graph.node(id);
    if (!node) continue;
    // Dagre reports centres; React Flow positions from the top-left corner.
    positions[id] = {
      x: Math.round(node.x - node.width / 2),
      y: Math.round(node.y - node.height / 2),
    };
  }
  return positions;
}

/**
 * The whole layout as one action, so a re-layout is one entry in the log and one press of
 * undo — not forty MoveObjects that have to be un-done forty times.
 */
export function layoutAction(
  scape: Scape,
  mode: LayoutMode = "LR",
  measured: Record<ObjectId, NodeSize> = {},
): ActionPayload {
  return { type: "LayoutScape", positions: layoutPositions(scape, mode, measured) };
}
