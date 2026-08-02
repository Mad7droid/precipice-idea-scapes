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
 * Per-type card widths.
 *
 * 220px suits a note or a journey — a title and a short list. It is far too narrow for a
 * wireframe, which is a twelve-column screen layout: at 220px a column is 15px wide, so
 * every label truncates to nothing and the mockup stops being readable as a screen.
 */
const NODE_WIDTHS: Record<string, number> = {
  wireframe: 380,
};

export function widthFor(type: string): number {
  return NODE_WIDTHS[type] ?? NODE_WIDTH;
}

/** How wide a card is drawn: the width the user dragged it to, or the default for its type. */
export const MIN_OBJECT_WIDTH = 200;
export const MAX_OBJECT_WIDTH = 900;

export function objectWidth(object: { type: string; data: Record<string, unknown> }): number {
  const stored = object.data?.width;
  if (typeof stored === "number" && Number.isFinite(stored)) {
    return Math.min(MAX_OBJECT_WIDTH, Math.max(MIN_OBJECT_WIDTH, stored));
  }
  return widthFor(object.type);
}

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
