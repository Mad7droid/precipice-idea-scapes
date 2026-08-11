import { MarkerType, type Edge, type Node } from "@xyflow/react";
import { getViewPlugin, type ViewObject } from "@/core/viewRegistry";
import type { PublishedScape } from "@/publish/contract";
import { VIEWER_NODE_TYPE, type ViewerNodeData } from "./ViewerNode";

/**
 * Turning a published snapshot into what React Flow draws.
 *
 * Every object is parsed through its own plugin's schema first, and one that fails is dropped
 * and counted — the same way the reducer drops an invalid action rather than refusing the whole
 * transaction. A single malformed object must not blank the page for a reader who had nothing
 * to do with authoring it.
 *
 * Objects of a type this build does not know are *kept*, not dropped: `ViewerNode` renders a
 * fallback card for them. A newer build's type is not corrupt data, it is data from the future,
 * and naming it is more use than hiding it.
 */
export interface Prepared {
  nodes: Node<ViewerNodeData>[];
  edges: Edge[];
  /** Shown as "N blocks could not be displayed". Never silently swallowed. */
  dropped: number;
}

export function prepare(scape: PublishedScape): Prepared {
  const nodes: Node<ViewerNodeData>[] = [];
  const kept = new Set<string>();
  let dropped = 0;

  for (const object of scape.objects) {
    const plugin = getViewPlugin(object.type);
    if (plugin && !plugin.schema.safeParse(object.data).success) {
      dropped += 1;
      continue;
    }

    const view: ViewObject = {
      id: object.id,
      type: object.type,
      title: object.title,
      data: object.data,
      x: object.x,
      y: object.y,
      ...(object.width === undefined ? {} : { width: object.width }),
    };

    kept.add(object.id);
    nodes.push({
      id: object.id,
      type: VIEWER_NODE_TYPE,
      position: { x: object.x, y: object.y },
      data: { object: view },
      draggable: false,
      connectable: false,
      selectable: false,
    });
  }

  // The Worker already drops relationships with a missing endpoint, but an object dropped
  // *here* for failing its schema leaves the same dangling edge, and React Flow throws on one.
  const edges: Edge[] = scape.relationships
    .filter((rel) => kept.has(rel.from) && kept.has(rel.to))
    .map((rel) => ({
      id: rel.id,
      source: rel.from,
      target: rel.to,
      type: "simplebezier",
      ...(rel.label ? { label: rel.label } : {}),
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
        color: "var(--text-secondary)",
      },
      // Public scapes need to read at a glance. The editor's quiet edge tone disappears into a
      // dark, zoomed-out viewer, so this intentionally uses the stronger semantic text colour.
      style: { stroke: "var(--text-secondary)", strokeWidth: 2, opacity: 0.9 },
    }));

  return { nodes, edges, dropped };
}
