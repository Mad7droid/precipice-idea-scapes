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

/**
 * Adaptive width: a text card whose content would wrap past this many lines at its default
 * width is drawn at `WIDE_NODE_WIDTHS` instead, so a long note reads as a paragraph rather than
 * a tall, narrow column.
 */
export const MAX_NARROW_LINES = 4;

const WIDE_NODE_WIDTHS: Record<string, number> = {
  note: 360,
  journey: 360,
  scape: 520,
};

/** Characters that fit on one line at 12px in a 220px card (196px of text, ~6px a character). */
const CHARS_PER_LINE = 33;

function wrappedLines(text: string, charsPerLine: number): number {
  return text
    .split("\n")
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.trim().length / charsPerLine)), 0);
}

/**
 * How many lines a card's content takes at its default width. An estimate, because measuring
 * needs a DOM and this module is shared with code that has none; it only has to be stable and
 * to agree between the editor and the viewer, which it does by being the one implementation.
 * Blank lines are free: they are paragraph breaks, not text.
 */
function estimatedLines(object: { type: string; data?: unknown }): number {
  const data = (object.data ?? {}) as { body?: unknown; steps?: unknown };

  if (object.type === "note" || object.type === "scape") {
    const body = typeof data.body === "string" ? data.body : "";
    return body
      .split("\n")
      .filter((line) => line.trim())
      .reduce((sum, line) => sum + wrappedLines(line, CHARS_PER_LINE), 0);
  }

  if (object.type === "journey" && Array.isArray(data.steps)) {
    // A step is indented by its number, so its label wraps sooner; the detail is smaller type.
    return data.steps.reduce((sum: number, step: unknown) => {
      const { label, detail } = (step ?? {}) as { label?: unknown; detail?: unknown };
      const labelLines = typeof label === "string" && label.trim() ? wrappedLines(label, 28) : 0;
      const detailLines =
        typeof detail === "string" && detail.trim() ? wrappedLines(detail, 34) : 0;
      return sum + labelLines + detailLines;
    }, 0);
  }

  return 0;
}

/**
 * How wide a card is drawn: the width the user dragged it to, else wide if its content runs
 * past `MAX_NARROW_LINES`, else the default for its type. A dragged width always wins, so
 * resizing is never fought by the content, and double-click-to-reset returns to the adaptive
 * width rather than to a fixed one.
 */
export function objectWidth(object: { type: string; width?: number; data?: unknown }): number {
  const stored = object.width;
  if (typeof stored === "number" && Number.isFinite(stored)) {
    return Math.min(MAX_OBJECT_WIDTH, Math.max(MIN_OBJECT_WIDTH, stored));
  }
  const wide = WIDE_NODE_WIDTHS[object.type];
  if (wide !== undefined && estimatedLines(object) > MAX_NARROW_LINES) return wide;
  return widthFor(object.type);
}
