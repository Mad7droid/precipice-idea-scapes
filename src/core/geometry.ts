/**
 * How wide a card is drawn.
 *
 * A leaf module with no imports, because both halves of the app need it and they may not share
 * anything heavier. The editor reaches it through `@/canvas/layout`, which re-exports it; the
 * public viewer imports it directly, and cannot use `layout.ts` because that pulls in Dagre.
 *
 * Width has to agree across the two: a published scape is rendered from the positions the
 * author arranged, so if the viewer picked a different default the layout it shows would not be
 * the layout anybody built. That is the drift this module exists to prevent — the same reason
 * there is one `ViewPlugin` per type rather than a parallel viewer component.
 */
export const NODE_WIDTH = 220;

/**
 * Per-type card widths.
 *
 * 220px suits a note or a journey — a title and a short list. It is far too narrow for a
 * wireframe, which is a twelve-column screen layout: at 220px a column is 15px wide, so
 * every label truncates to nothing and the mockup stops being readable as a screen. A scape
 * block has the same problem for a different reason: it is a document, and a document with a
 * table in it needs a measure you can actually read a sentence across.
 */
const NODE_WIDTHS: Record<string, number> = {
  wireframe: 380,
  scape: 380,
};

export function widthFor(type: string): number {
  return NODE_WIDTHS[type] ?? NODE_WIDTH;
}

/**
 * The bounds a stored width is clamped to. `publishedObjectSchema` in `src/publish/contract.ts`
 * declares the same range on the wire, so a hostile payload cannot ask for a 50,000px card.
 */
export const MIN_OBJECT_WIDTH = 200;
export const MAX_OBJECT_WIDTH = 900;

/** The width the user dragged the card to, or the default for its type. */
export function objectWidth(object: { type: string; width?: number }): number {
  const stored = object.width;
  if (typeof stored === "number" && Number.isFinite(stored)) {
    return Math.min(MAX_OBJECT_WIDTH, Math.max(MIN_OBJECT_WIDTH, stored));
  }
  return widthFor(object.type);
}
