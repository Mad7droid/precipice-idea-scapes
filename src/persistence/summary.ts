import type { Scape, ScapePreview, ScapeSummary } from "@/core/types";

/**
 * The row the home page renders, derived from a snapshot.
 *
 * Both repositories already hold the whole document in memory when they list, so deriving
 * this costs nothing extra and saves the home page from loading every scape it wants to draw.
 *
 * Shared between the Dexie and in-memory implementations so the two cannot disagree about
 * what a summary is — the conformance suite runs against both.
 */

/** Above this, a thumbnail is a smudge and the extra dots cost more than they say. */
const MAX_PREVIEW_NODES = 60;

export function summarize(scape: Scape): ScapeSummary {
  const typeCounts: Record<string, number> = {};
  for (const id of scape.objectOrder) {
    const object = scape.objects[id];
    if (!object) continue;
    typeCounts[object.type] = (typeCounts[object.type] ?? 0) + 1;
  }

  const summary: ScapeSummary = {
    id: scape.id,
    name: scape.name,
    updatedAt: scape.updatedAt,
    objectCount: scape.objectOrder.length,
    relationshipCount: Object.keys(scape.relationships).length,
    typeCounts,
  };

  const starter = scape.meta?.starter;
  if (typeof starter === "string") summary.starter = starter;

  const preview = previewOf(scape);
  if (preview) summary.preview = preview;

  return summary;
}

/**
 * A thumbnail as data rather than as an image.
 *
 * Rendering the canvas offscreen would mean a rendering pipeline, a cache and an invalidation
 * story. The positions are already in the snapshot, so normalising them into a unit box and
 * letting the list draw twenty circles and a few lines gets the thing that actually matters —
 * you can tell a mind map from a flow at a glance — for none of that cost.
 */
export function previewOf(scape: Scape): ScapePreview | undefined {
  const objects = scape.objectOrder
    .map((id) => scape.objects[id])
    .filter((o): o is NonNullable<typeof o> => !!o)
    .slice(0, MAX_PREVIEW_NODES);

  if (objects.length === 0) return undefined;

  const xs = objects.map((o) => o.x);
  const ys = objects.map((o) => o.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  // A single object, or a perfect row, has zero extent on one axis. Guard the divide and let
  // it sit on the centre line rather than at the edge.
  const spanX = Math.max(...xs) - minX || 1;
  const spanY = Math.max(...ys) - minY || 1;

  const index = new Map(objects.map((o, i) => [o.id, i]));
  const round = (n: number) => Math.round(n * 1000) / 1000;

  return {
    nodes: objects.map((o) => ({
      x: round((o.x - minX) / spanX),
      y: round((o.y - minY) / spanY),
      type: o.type,
    })),
    edges: Object.values(scape.relationships)
      .map((rel) => [index.get(rel.from), index.get(rel.to)] as const)
      .filter(
        (pair): pair is readonly [number, number] => pair[0] !== undefined && pair[1] !== undefined,
      )
      .map(([from, to]) => [from, to] as [number, number]),
  };
}
