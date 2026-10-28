import type { Scape, ViewState } from "@/core/types";

/**
 * Panel geometry, in pixels. Mirrors the `--panel-*` tokens in `src/design/tokens.css`; the
 * resizers need numbers to clamp against, the styles read the tokens.
 */
export const PANEL = {
  left: 280,
  right: 320,
  min: 260,
  max: 440,
  /** Arrow-key resize step for the separators. */
  step: 16,
} as const;

/** Below this window width the outline starts collapsed so the canvas keeps its room. */
export const OUTLINE_COLLAPSE_BELOW = 1024;
/** Below this the inspector also starts collapsed. */
export const INSPECTOR_COLLAPSE_BELOW = 768;

export const clampPanel = (width: number) => Math.max(PANEL.min, Math.min(PANEL.max, width));

/** A conservative card footprint: enough to say "some of it is on screen". */
const CARD = { width: 240, height: 120 };

/**
 * Whether any object would be at least partly visible in a `width`×`height` canvas at the
 * saved viewport. A viewport saved in a larger window can put everything off-screen in a
 * smaller one; the editor fits the view when this says nothing would show.
 */
export function viewportShowsContent(
  scape: Pick<Scape, "objects" | "objectOrder">,
  view: ViewState,
  width: number,
  height: number,
): boolean {
  if (scape.objectOrder.length === 0 || width <= 0 || height <= 0) return true;
  return scape.objectOrder.some((id) => {
    const object = scape.objects[id];
    if (!object) return false;
    const left = object.x * view.zoom + view.x;
    const top = object.y * view.zoom + view.y;
    const right = left + (object.width ?? CARD.width) * view.zoom;
    const bottom = top + CARD.height * view.zoom;
    return right > 0 && bottom > 0 && left < width && top < height;
  });
}

/**
 * The canvas's per-type visibility filter. The canvas persists it under this key; reading it
 * here keeps select-all from reaching blocks the person has hidden from view.
 */
const HIDDEN_TYPES_KEY = "precipice.view.hiddenTypes";
export function readHiddenTypes(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(HIDDEN_TYPES_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string") : []);
  } catch {
    return new Set();
  }
}

/** Every object id whose type is currently shown on the canvas, in document order. */
export function visibleObjectIds(
  scape: Pick<Scape, "objects" | "objectOrder">,
  hidden: Set<string> = readHiddenTypes(),
): string[] {
  return scape.objectOrder.filter((id) => {
    const object = scape.objects[id];
    return object && !hidden.has(object.type);
  });
}
