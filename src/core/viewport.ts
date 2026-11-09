/**
 * The small-screen and touch contract.
 *
 * Every workstream that makes a surface work on a phone builds against the values and the
 * gesture table in this file, so that "long-press" means the same 500ms in the canvas, the
 * outline and the home grid, and a sheet snaps the same way wherever it is used.
 *
 * A leaf module with no imports: the viewer needs it too, and may not pull in the store.
 *
 * Two independent questions, deliberately kept apart:
 *  - **Layout** is decided by width (`layoutClassFor`). A narrow desktop window gets the
 *    compact layout.
 *  - **Interaction** is decided by the primary pointer (`InputMode`). An iPad with a trackpad
 *    keeps hover and shortcuts; a narrow desktop window never gets long-press.
 */

/* ---------- Layout ---------- */

export type LayoutClass = "compact" | "medium" | "expanded";

/**
 * Lower bounds, in CSS px. Mirrored by the `medium` / `expanded` screens in tailwind.config.ts
 * (which also equal Tailwind's default `sm` / `lg`, so existing `sm:` classes stay correct).
 */
export const BREAKPOINTS = {
  medium: 640,
  expanded: 1024,
} as const;

export function layoutClassFor(width: number): LayoutClass {
  if (!Number.isFinite(width) || width < BREAKPOINTS.medium) return "compact";
  if (width < BREAKPOINTS.expanded) return "medium";
  return "expanded";
}

/* ---------- Input ---------- */

export type InputMode = "fine" | "coarse";

/** Media queries the hooks and the stylesheet agree on. */
export const MEDIA = {
  coarse: "(pointer: coarse)",
  hoverNone: "(hover: none)",
  reducedMotion: "(prefers-reduced-motion: reduce)",
  standalone: "(display-mode: standalone)",
} as const;

/* ---------- Touch timing and tolerances ---------- */

export const TOUCH = {
  /** Minimum hit target on a coarse pointer, CSS px. Apple HIG / Material agree on ~44–48. */
  hitMin: 44,
  /** Hold this long without moving to fire a long-press. */
  longPressMs: 500,
  /** Hold this long on a node before a drag moves it rather than panning the canvas. */
  dragHoldMs: 150,
  /** Movement that cancels a pending press and turns it into a pan or scroll. */
  moveTolerance: 8,
  /** Two taps closer than this are a double-tap. */
  doubleTapMs: 300,
  /** A sheet released faster than this (px/ms) follows the flick, not the position. */
  flickVelocity: 0.5,
  /** Minimum horizontal travel for a swipe on a sheet header to count. */
  swipeMin: 56,
} as const;

/* ---------- Sheets ---------- */

/**
 * Where a bottom sheet can rest. Fractions are of the visible viewport height (the visual
 * viewport, so the on-screen keyboard is already subtracted).
 *
 * `peek` shows the header only — enough to name what is selected without covering the
 * canvas. `half` is the working state. `full` is for typing.
 */
export type SheetSnap = "closed" | "peek" | "half" | "full";

export const SHEET_SNAP_FRACTION: Record<Exclude<SheetSnap, "closed">, number> = {
  peek: 0.18,
  half: 0.5,
  full: 0.92,
};

/** The header height a `peek` never goes below, CSS px. */
export const SHEET_PEEK_MIN = 88;

export function sheetHeightFor(snap: SheetSnap, viewportHeight: number): number {
  if (snap === "closed") return 0;
  const height = Math.round(SHEET_SNAP_FRACTION[snap] * viewportHeight);
  return snap === "peek" ? Math.max(SHEET_PEEK_MIN, height) : height;
}

/**
 * Where a sheet lands when the user lets go of it.
 *
 * A flick wins over position: flicking down from `full` goes one step down even if the
 * finger travelled only a little. A slow release lands on the nearest allowed snap. Dragging
 * below the lowest allowed snap by more than half its height closes the sheet, if closing is
 * allowed.
 *
 * @param height   current sheet height in px at release
 * @param velocity px/ms, positive = moving down (sheet shrinking)
 * @param allowed  snaps this sheet supports, any order; `closed` means it can be dismissed
 */
export function resolveSheetSnap(
  height: number,
  velocity: number,
  viewportHeight: number,
  allowed: readonly SheetSnap[],
): SheetSnap {
  const order: SheetSnap[] = ["closed", "peek", "half", "full"];
  const stops = order
    .filter((snap) => allowed.includes(snap))
    .map((snap) => ({ snap, height: sheetHeightFor(snap, viewportHeight) }));
  if (stops.length === 0) return "closed";

  if (Math.abs(velocity) >= TOUCH.flickVelocity) {
    const goingDown = velocity > 0;
    const candidates = goingDown
      ? stops.filter((stop) => stop.height < height).reverse()
      : stops.filter((stop) => stop.height > height);
    if (candidates[0]) return candidates[0].snap;
    return goingDown ? stops[0].snap : stops[stops.length - 1].snap;
  }

  let best = stops[0];
  for (const stop of stops) {
    if (Math.abs(stop.height - height) < Math.abs(best.height - height)) best = stop;
  }
  return best.snap;
}

/* ---------- The gesture table ---------- */

export type GestureSurface = "canvas" | "node" | "edge" | "sheet" | "list" | "composer" | "global";

export interface GestureSpec {
  surface: GestureSurface;
  gesture: string;
  result: string;
  /**
   * The visible control that does the same thing. Every gesture has one: gestures are
   * accelerators, never the only path. `null` only where the gesture *is* the basic
   * manipulation (pan, pinch, drag).
   */
  visibleAlternative: string | null;
}

/**
 * The complete touch vocabulary, fixed before any surface is built.
 *
 * Deliberately absent:
 *  - Edge swipes from the left or right screen edge. iOS Safari and Android use them for
 *    back/forward; claiming them fights the browser.
 *  - Swipe-to-delete on list rows. Destructive and undiscoverable; delete lives in the menu.
 *  - Three-finger and four-finger gestures. iOS reserves three-finger swipes for undo at the
 *    system level and they collide with text editing.
 */
export const GESTURES: readonly GestureSpec[] = [
  // Canvas
  { surface: "canvas", gesture: "one-finger drag on empty space", result: "pan", visibleAlternative: null },
  { surface: "canvas", gesture: "pinch", result: "zoom around the pinch centre", visibleAlternative: null },
  { surface: "canvas", gesture: "tap empty space", result: "clear selection, collapse inspector to closed", visibleAlternative: null },
  { surface: "canvas", gesture: "double-tap empty space", result: "fit view", visibleAlternative: "Fit view in the action bar" },
  { surface: "canvas", gesture: "long-press empty space", result: "add menu anchored at that point; new object lands there", visibleAlternative: "Add in the action bar" },
  { surface: "canvas", gesture: "two-finger tap", result: "undo", visibleAlternative: "Undo in the action bar" },

  // Nodes
  { surface: "node", gesture: "tap", result: "select; inspector opens at peek; selection pill appears", visibleAlternative: null },
  { surface: "node", gesture: "tap a selected node", result: "inspector to half", visibleAlternative: "Edit in the selection pill" },
  { surface: "node", gesture: "hold 150ms then drag", result: "move; one MoveObject on release, one undo step", visibleAlternative: null },
  { surface: "node", gesture: "long-press without moving", result: "action sheet: edit, connect, duplicate, ask AI, delete", visibleAlternative: "More in the selection pill" },
  { surface: "node", gesture: "drag from a handle", result: "connect", visibleAlternative: "Connect in the selection pill, then tap the target" },

  // Edges
  { surface: "edge", gesture: "tap", result: "select relationship; relationship inspector at peek", visibleAlternative: null },
  { surface: "edge", gesture: "long-press", result: "action sheet: edit label, reverse, delete", visibleAlternative: "More in the selection pill" },

  // Sheets
  { surface: "sheet", gesture: "drag the grabber or header", result: "move between snaps", visibleAlternative: "Tap the grabber to cycle peek → half → full" },
  { surface: "sheet", gesture: "flick or drag down past the lowest snap", result: "dismiss", visibleAlternative: "Close button in the sheet header" },
  { surface: "sheet", gesture: "horizontal swipe on the inspector header", result: "previous / next object in outline order", visibleAlternative: "Chevrons in the inspector header" },
  { surface: "sheet", gesture: "tap the scrim", result: "dismiss (modal sheets only)", visibleAlternative: "Close button in the sheet header" },

  // Lists (outline, home grid, scape list)
  { surface: "list", gesture: "tap", result: "open / select", visibleAlternative: null },
  { surface: "list", gesture: "long-press", result: "row action sheet", visibleAlternative: "⋯ button on every row, always visible on touch" },

  // Composer
  { surface: "composer", gesture: "tap the collapsed pill", result: "expand above the keyboard and focus", visibleAlternative: "Generate in the action bar" },
  { surface: "composer", gesture: "drag down on the expanded composer", result: "collapse, keeping the draft", visibleAlternative: "Collapse button" },

  // Global
  { surface: "global", gesture: "hardware keyboard shortcuts", result: "unchanged from desktop, including on iPad", visibleAlternative: "Shortcuts listed in Help" },
] as const;
