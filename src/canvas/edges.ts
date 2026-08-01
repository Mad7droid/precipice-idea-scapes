import type { Edge, Node } from "@xyflow/react";
import type { ObjectId, Scape, ScapeObject } from "@/core/types";

export const OBJECT_NODE_TYPE = "object";

export interface ObjectNodeData extends Record<string, unknown> {
  object: ScapeObject;
  /** True only for a node that mounted while the AI was streaming it in — the one spring the
   * design language allows. Manual creation (duplicate, import, relayout) gets no entrance
   * animation. */
  justGenerated?: boolean;
}

/** React Flow nodes derived from the Scape. The store is the source of truth, not React Flow. */
export function toFlowNodes(scape: Scape, selection: ObjectId[]): Node<ObjectNodeData>[] {
  const selected = new Set(selection);
  return scape.objectOrder
    .map((id) => scape.objects[id])
    .filter(Boolean)
    .map((object) => ({
      id: object.id,
      type: OBJECT_NODE_TYPE,
      position: { x: object.x, y: object.y },
      data: { object },
      selected: selected.has(object.id),
    }));
}

/**
 * Reconciles the local React Flow mirror against the Scape.
 *
 * Rebuilding the array from scratch loses React Flow's own per-node fields — `measured` above
 * all — and React Flow silently drops every edge whose endpoints have no measured handle
 * geometry. The visible symptom is all edges disappearing the moment anything changes.
 *
 * So: merge by id, and return the *same node object* when nothing about it changed. That
 * keeps measurements, keeps selection, and keeps ObjectNode's memo from re-rendering the
 * other 199 nodes when one of them moves.
 */
export function mergeFlowNodes(
  previous: Node<ObjectNodeData>[],
  scape: Scape,
  isGenerating = false,
): Node<ObjectNodeData>[] {
  const byId = new Map(previous.map((n) => [n.id, n]));

  return scape.objectOrder
    .map((id) => {
      const object = scape.objects[id];
      if (!object) return undefined;

      const existing = byId.get(id);
      if (!existing) {
        return {
          id: object.id,
          type: OBJECT_NODE_TYPE,
          position: { x: object.x, y: object.y },
          data: { object, justGenerated: isGenerating },
        } satisfies Node<ObjectNodeData>;
      }

      const samePosition = existing.position.x === object.x && existing.position.y === object.y;
      const sameObject = existing.data.object === object;
      if (samePosition && sameObject) return existing;

      return {
        ...existing,
        position: samePosition ? existing.position : { x: object.x, y: object.y },
        data: sameObject ? existing.data : { object, justGenerated: existing.data.justGenerated },
      };
    })
    .filter((n): n is Node<ObjectNodeData> => n !== undefined);
}

/**
 * How much of the relationship graph is drawn.
 *
 * A scape of any size draws as spaghetti when every edge is on at once, and most of the time
 * the lines are not what you are reading — the cards are. So the default is `none`, and the
 * graph is something you ask for.
 */
export type EdgeMode = "none" | "selected" | "all";

/**
 * Edges are derived from `scape.relationships` every render rather than stored separately,
 * so they cannot drift out of sync with the graph they describe.
 */
export function toFlowEdges(
  scape: Scape,
  selection: ObjectId[],
  mode: EdgeMode = "all",
  hidden: Set<string> = new Set(),
): Edge[] {
  if (mode === "none") return [];

  const selected = new Set(selection);
  const visible = (id: ObjectId) => {
    const object = scape.objects[id];
    return !!object && !hidden.has(object.type);
  };

  return Object.values(scape.relationships)
    .filter((rel) => visible(rel.from) && visible(rel.to))
    .map((rel) => {
      // An edge reads as active when either end is selected — that is what makes clicking a
      // node show you what it is connected to.
      const active = selected.has(rel.from) || selected.has(rel.to);
      return { rel, active };
    })
    // In `selected` mode the graph is answering one question — "what is this connected to?"
    // — so everything that is not part of the answer is noise.
    .filter(({ active }) => (mode === "selected" ? active : true))
    .map(({ rel, active }) => {
      // When something is selected, everything else recedes rather than competing with it.
      const dimmed = selected.size > 0 && !active;
      return {
        id: rel.id,
        source: rel.from,
        target: rel.to,
        // Orthogonal, not bezier: in a dense graph curved edges read as tangle, and a
        // stepped path makes it possible to follow one line with your eye.
        type: "smoothstep",
        // Labels are the densest thing on the canvas and the first thing to become
        // unreadable, so they appear only on the edges currently being asked about.
        ...(rel.label && active ? { label: rel.label } : {}),
        style: {
          stroke: active ? "var(--edge-stroke-active)" : "var(--edge-stroke)",
          strokeWidth: active ? 2 : 1.5,
          opacity: dimmed ? 0.25 : 1,
        },
        labelStyle: {
          fill: "var(--text-secondary)",
          fontSize: "var(--text-2xs)",
          fontFamily: "var(--font-mono)",
        },
        labelBgStyle: { fill: "var(--bg-raised)" },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 9999,
      } satisfies Edge;
    });
}
