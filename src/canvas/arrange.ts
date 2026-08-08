import type { ObjectId, Scape } from "@/core/types";

/**
 * The two layouts Dagre does not do.
 *
 * Dagre is a layered graph drawer: it is exactly right for a flow and exactly wrong for a
 * mind map, which has no layers, and for a set of screens, which has no flow. Running
 * everything through it is why every scape used to look the same regardless of what it was.
 *
 * Both functions here take the same shape as `layoutPositions` and return top-left corners in
 * canvas coordinates, normalised to a fixed margin so the camera behaves the same whichever
 * mode ran.
 */

export interface NodeSize {
  width: number;
  height: number;
}

export type SizeLookup = (id: ObjectId) => NodeSize;

export type Positions = Record<ObjectId, { x: number; y: number }>;

const MARGIN = 48;

/** Breathing room between rings, and between a ring and the cards on it. */
const RING_GAP = 96;
/** Minimum arc each card is given, so a ring of two does not put them on top of each other. */
const ARC_PADDING = 56;

const COL_GAP = 72;
const ROW_GAP = 88;

/**
 * Radial layout — a mind map.
 *
 * The root is the most connected object, which is almost always the one the scape is about.
 * Children are placed in rings by graph distance, and each subtree is given an angular sector
 * proportional to how many leaves it contains. That last part is what stops the branches
 * crossing: a node always sits inside the wedge its parent owns, so two branches can only
 * overlap if they were given overlapping sectors, and they never are.
 *
 * Objects the root cannot reach are not dropped — they go on one more ring outside the tree,
 * which is a useful thing to be able to see rather than a rendering compromise.
 */
export function radialPositions(scape: Scape, size: SizeLookup): Positions {
  const ids = scape.objectOrder.filter((id) => scape.objects[id]);
  if (ids.length === 0) return {};

  const neighbours = new Map<ObjectId, ObjectId[]>(ids.map((id) => [id, []]));
  for (const rel of Object.values(scape.relationships)) {
    if (!neighbours.has(rel.from) || !neighbours.has(rel.to)) continue;
    neighbours.get(rel.from)!.push(rel.to);
    neighbours.get(rel.to)!.push(rel.from);
  }

  // Most connected wins; ties break on document order so the result is deterministic.
  const root = ids.reduce((best, id) =>
    neighbours.get(id)!.length > neighbours.get(best)!.length ? id : best,
  );

  // Breadth-first, so every node's parent is on the ring immediately inside it.
  const depth = new Map<ObjectId, number>([[root, 0]]);
  const children = new Map<ObjectId, ObjectId[]>(ids.map((id) => [id, []]));
  const queue: ObjectId[] = [root];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    for (const next of neighbours.get(current)!) {
      if (depth.has(next)) continue;
      depth.set(next, depth.get(current)! + 1);
      children.get(current)!.push(next);
      queue.push(next);
    }
  }

  const detached = ids.filter((id) => !depth.has(id));

  // Leaf count per subtree. A branch with eight leaves earns eight times the arc of a branch
  // with one, which is what keeps a lopsided tree from bunching up on one side.
  const weight = new Map<ObjectId, number>();
  for (let i = queue.length - 1; i >= 0; i--) {
    const id = queue[i];
    const kids = children.get(id)!;
    weight.set(id, kids.length === 0 ? 1 : kids.reduce((sum, kid) => sum + weight.get(kid)!, 0));
  }

  const byDepth: ObjectId[][] = [];
  for (const [id, d] of depth) (byDepth[d] ??= []).push(id);
  if (detached.length > 0) byDepth[byDepth.length] = detached;

  /**
   * Angles first, radii second.
   *
   * A node's angle depends only on the shape of the tree, never on how far out it sits — so
   * it can be settled before any radius is known. Doing it in that order is what lets a ring
   * be sized from the *real* extent of the cards on it: a card is an axis-aligned box, and how
   * much room it needs going outward depends on which way it is facing. A 380px-wide
   * wireframe pointing right needs 190px of radial clearance; the same card pointing up needs
   * only half its height.
   *
   * Sizing rings by height alone is tight but wrong — it overlaps wide cards on the horizontal
   * axis. Sizing them by max(width, height) is correct but double-counts, and a chain of tall
   * cards lands on a ring thousands of pixels across that no amount of zooming out will frame.
   */
  const angle = new Map<ObjectId, number>([[root, 0]]);

  // Walk the tree, handing each child a slice of its parent's wedge and taking the middle of
  // that slice. A node always sits inside the wedge its parent owns, which is what stops two
  // branches from crossing. Iterative rather than recursive: a 200-note chain is a legal scape.
  const wedges: Array<[ObjectId, number, number]> = [[root, -Math.PI / 2, Math.PI * 1.5]];
  while (wedges.length > 0) {
    const [id, start, end] = wedges.pop()!;
    const kids = children.get(id)!;
    if (kids.length === 0) continue;
    const total = kids.reduce((sum, kid) => sum + weight.get(kid)!, 0);
    let cursor = start;
    for (const kid of kids) {
      const span = ((end - start) * weight.get(kid)!) / total;
      angle.set(kid, cursor + span / 2);
      wedges.push([kid, cursor, cursor + span]);
      cursor += span;
    }
  }

  // Anything the root could not reach goes on one more ring, evenly spaced. Being able to see
  // that these are unattached is the point.
  detached.forEach((id, i) => angle.set(id, (i / detached.length) * Math.PI * 2));

  /** Half the card's extent along the radius, and along the ring, at the angle it faces. */
  const extents = (id: ObjectId) => {
    const s = size(id);
    const a = angle.get(id) ?? 0;
    const cos = Math.abs(Math.cos(a));
    const sin = Math.abs(Math.sin(a));
    return {
      radial: (s.width * cos + s.height * sin) / 2,
      tangential: (s.width * sin + s.height * cos) / 2,
    };
  };

  // Each ring has to clear the one inside it *and* be long enough to seat its own cards.
  const radii: number[] = [0];
  for (let d = 1; d < byDepth.length; d++) {
    const ring = byDepth[d] ?? [];
    const inner = byDepth[d - 1] ?? [];
    const clearance =
      radii[d - 1] +
      Math.max(0, ...inner.map((id) => extents(id).radial)) +
      RING_GAP +
      Math.max(0, ...ring.map((id) => extents(id).radial));
    const circumference = ring.reduce(
      (sum, id) => sum + extents(id).tangential * 2 + ARC_PADDING,
      0,
    );
    radii[d] = Math.max(clearance, circumference / (2 * Math.PI));
  }

  const positions: Positions = {};
  for (const id of ids) {
    const s = size(id);
    const a = angle.get(id) ?? 0;
    const radius = radii[depth.get(id) ?? byDepth.length - 1] ?? 0;
    positions[id] = {
      x: Math.round(Math.cos(a) * radius - s.width / 2),
      y: Math.round(Math.sin(a) * radius - s.height / 2),
    };
  }

  return normalize(positions);
}

/**
 * Grid layout — a contact sheet.
 *
 * For a scape whose objects are peers rather than a sequence: a set of screens, a wall of
 * notes. Objects are grouped by type (groups in the order the types first appear, so nothing
 * here hardcodes a type name) and filled row-major. Column widths and row heights are taken
 * from the widest and tallest card in each, so a resized wireframe does not overlap the card
 * beside it.
 */
export function gridPositions(scape: Scape, size: SizeLookup): Positions {
  const ids = scape.objectOrder.filter((id) => scape.objects[id]);
  if (ids.length === 0) return {};

  const typeOrder: string[] = [];
  for (const id of ids) {
    const type = scape.objects[id]!.type;
    if (!typeOrder.includes(type)) typeOrder.push(type);
  }
  const ordered = [...ids].sort((a, b) => {
    const rank =
      typeOrder.indexOf(scape.objects[a]!.type) - typeOrder.indexOf(scape.objects[b]!.type);
    return rank !== 0 ? rank : ids.indexOf(a) - ids.indexOf(b);
  });

  // Slightly wider than square: screens are read on landscape displays.
  const columns = Math.min(5, Math.max(1, Math.round(Math.sqrt(ordered.length * 1.4))));
  const rows = Math.ceil(ordered.length / columns);

  const colWidth = Array.from({ length: columns }, (_, c) =>
    Math.max(0, ...ordered.filter((_, i) => i % columns === c).map((id) => size(id).width)),
  );
  const rowHeight = Array.from({ length: rows }, (_, r) =>
    Math.max(
      0,
      ...ordered.filter((_, i) => Math.floor(i / columns) === r).map((id) => size(id).height),
    ),
  );

  const colX: number[] = [];
  for (let c = 0; c < columns; c++) {
    colX[c] = c === 0 ? 0 : colX[c - 1] + colWidth[c - 1] + COL_GAP;
  }
  const rowY: number[] = [];
  for (let r = 0; r < rows; r++) {
    rowY[r] = r === 0 ? 0 : rowY[r - 1] + rowHeight[r - 1] + ROW_GAP;
  }

  const positions: Positions = {};
  ordered.forEach((id, i) => {
    const c = i % columns;
    const r = Math.floor(i / columns);
    const s = size(id);
    // Centred in its cell, so a narrow note between two wide screens does not look adrift.
    positions[id] = {
      x: Math.round(colX[c] + (colWidth[c] - s.width) / 2),
      y: Math.round(rowY[r]),
    };
  });

  return normalize(positions);
}

/** Shifts a layout so its top-left sits at a fixed margin, whichever mode produced it. */
function normalize(positions: Positions): Positions {
  const values = Object.values(positions);
  if (values.length === 0) return positions;
  const minX = Math.min(...values.map((p) => p.x));
  const minY = Math.min(...values.map((p) => p.y));
  const dx = MARGIN - minX;
  const dy = MARGIN - minY;
  const shifted: Positions = {};
  for (const [id, p] of Object.entries(positions)) {
    shifted[id] = { x: p.x + dx, y: p.y + dy };
  }
  return shifted;
}
