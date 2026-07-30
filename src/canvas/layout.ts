import dagre from "dagre";
import type { ActionPayload } from "@/core/actions";
import type { ObjectId, Scape } from "@/core/types";

/**
 * Auto-layout. This is the only place in the app that decides where an object sits.
 *
 * The model never emits coordinates — `CreateObject` has no x/y — so every newly created
 * object arrives at the origin and this runs to place it.
 */

export const NODE_WIDTH = 220;

/**
 * Fallback heights, used before React Flow has measured a node — which is always the case
 * for objects that were created moments ago by a streaming generation.
 */
const FALLBACK_HEIGHT: Record<string, number> = {
  note: 116,
  journey: 168,
  wireframe: 190,
};
const DEFAULT_HEIGHT = 130;

export type Direction = "LR" | "TB";

export interface NodeSize {
  width: number;
  height: number;
}

export function layoutPositions(
  scape: Scape,
  direction: Direction = "LR",
  measured: Record<ObjectId, NodeSize> = {},
): Record<ObjectId, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: direction,
    // Generous enough that a 220px card never touches its neighbour, tight enough that a
    // twelve-object scape still fits on one screen at 1x.
    nodesep: 48,
    ranksep: 96,
    marginx: 32,
    marginy: 32,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const id of scape.objectOrder) {
    const object = scape.objects[id];
    if (!object) continue;
    const size = measured[id];
    graph.setNode(id, {
      width: size?.width ?? NODE_WIDTH,
      height: size?.height ?? FALLBACK_HEIGHT[object.type] ?? DEFAULT_HEIGHT,
    });
  }

  for (const rel of Object.values(scape.relationships)) {
    // Dagre throws on an edge to a node it does not know about.
    if (!scape.objects[rel.from] || !scape.objects[rel.to]) continue;
    graph.setEdge(rel.from, rel.to);
  }

  dagre.layout(graph);

  const positions: Record<ObjectId, { x: number; y: number }> = {};
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
  direction: Direction = "LR",
  measured: Record<ObjectId, NodeSize> = {},
): ActionPayload {
  return { type: "LayoutScape", positions: layoutPositions(scape, direction, measured) };
}
