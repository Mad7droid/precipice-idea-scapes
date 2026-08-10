import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { ObjectId, Scape, ScapeObject } from "@/core/types";
import type { EdgeMode } from "@/starters";

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
        data: sameObject
          ? existing.data
          : {
              object,
              justGenerated: existing.data.justGenerated,
            },
      };
    })
    .filter((n): n is Node<ObjectNodeData> => n !== undefined);
}

export type { EdgeMode } from "@/starters";

/**
 * Edges are derived from `scape.relationships` every render rather than stored separately,
 * so they cannot drift out of sync with the graph they describe.
 *
 * `mode` decides how much of the graph is drawn and comes from the scape's starter: a mind
 * map without its edges is not a mind map, while a wall of screens threaded with lines is
 * unreadable. It used to default to `none` for every scape, which meant the relationship
 * graph — the thing the whole document is about — was invisible until you found a menu.
 */
export function toFlowEdges(
  scape: Scape,
  selection: ObjectId[],
  mode: EdgeMode = "all",
  hidden: Set<string> = new Set(),
  selectedEdgeId: string | null = null,
): Edge[] {
  if (mode === "none") return [];

  const selected = new Set(selection);
  const visible = (id: ObjectId) => {
    const object = scape.objects[id];
    return !!object && !hidden.has(object.type);
  };

  return (
    Object.values(scape.relationships)
      .filter((rel) => visible(rel.from) && visible(rel.to))
      .map((rel) => {
        // An edge reads as active when either end is selected — that is what makes clicking a
        // node show you what it is connected to — or when the edge itself is selected.
        const active = selected.has(rel.from) || selected.has(rel.to) || selectedEdgeId === rel.id;
        return { rel, active };
      })
      // In `selected` mode the graph is answering one question — "what is this connected to?"
      // — so everything that is not part of the answer is noise.
      .filter(({ active }) => (mode === "selected" ? active : true))
      .map(({ rel, active }) => {
        const isSelected = selectedEdgeId === rel.id;
        // When something is selected, everything else recedes rather than competing with it.
        const dimmed = (selected.size > 0 || selectedEdgeId !== null) && !active;
        const stroke = active ? "var(--edge-stroke-active)" : "var(--edge-stroke)";
        return {
          id: rel.id,
          source: rel.from,
          target: rel.to,
          type: "simplebezier",
          selected: isSelected,
          // A relationship is directed. Without a head, "A relates to B" and "B relates to A"
          // draw identically, which makes half the graph's meaning unreadable.
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: stroke,
          },
          // Labels are the densest thing on the canvas and the first thing to become
          // unreadable, so they appear only on the edges currently being asked about.
          ...(rel.label && active ? { label: rel.label } : {}),
          style: {
            stroke,
            strokeWidth: isSelected ? 2.5 : active ? 2 : 1.5,
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
      })
  );
}
