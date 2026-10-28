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

  // Blocks with no relationships carry no ordering, and Dagre stacks them in one tall column
  // at rank zero. They are laid out as a grid next to the graph instead.
  const linked = new Set<ObjectId>();
  for (const rel of Object.values(scape.relationships)) {
    if (!scape.objects[rel.from] || !scape.objects[rel.to]) continue;
    linked.add(rel.from);
    linked.add(rel.to);
  }

  for (const id of scape.objectOrder) {
    const object = scape.objects[id];
    if (!object || !linked.has(id)) continue;
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
  let right = 0;
  let bottom = 0;
  for (const id of scape.objectOrder) {
    if (!linked.has(id)) continue;
    const node = graph.node(id);
    if (!node) continue;
    // Dagre reports centres; React Flow positions from the top-left corner.
    positions[id] = {
      x: Math.round(node.x - node.width / 2),
      y: Math.round(node.y - node.height / 2),
    };
    right = Math.max(right, node.x + node.width / 2);
    bottom = Math.max(bottom, node.y + node.height / 2);
  }

  const loose = scape.objectOrder.filter((id) => scape.objects[id] && !linked.has(id));
  if (loose.length === 0) return positions;
  const size = sizeLookup(scape, measured);
  const columns = Math.ceil(Math.sqrt(loose.length));
  const cellWidth = Math.max(...loose.map((id) => size(id).width)) + GRID_GAP;
  const rows: ObjectId[][] = [];
  for (let i = 0; i < loose.length; i += columns) rows.push(loose.slice(i, i + columns));
  // Below a left-to-right graph, beside a top-to-bottom one, so the grid never sits in the
  // direction the graph reads.
  const hasGraph = linked.size > 0;
  const originX = hasGraph && direction === "TB" ? right + GRID_GAP * 2 : MARGIN;
  let y = hasGraph && direction === "LR" ? bottom + GRID_GAP * 2 : MARGIN;
  for (const row of rows) {
    row.forEach((id, column) => {
      positions[id] = { x: Math.round(originX + column * cellWidth), y: Math.round(y) };
    });
    y += Math.max(...row.map((id) => size(id).height)) + GRID_GAP;
  }
  return positions;
}

const MARGIN = 48;
const GRID_GAP = 72;

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
