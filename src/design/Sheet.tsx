import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { resolveSheetSnap, sheetHeightFor, type SheetSnap } from "@/core/viewport";
import { useVisualViewport } from "@/shared/useLayout";

/**
 * A bottom sheet: the compact layout's replacement for side panels, popovers and modals.
 *
 * Two kinds, chosen with `modal`:
 *  - **Modal** (settings, publish, pickers, action sheets): scrim behind, focus trapped,
 *    the page behind is inert. Tap the scrim or swipe down to dismiss.
 *  - **Non-modal** (the inspector): no scrim, the canvas stays interactive above it. It rests
 *    at `peek` so the selection is named without hiding the thing selected.
 *
 * The snap is controlled. The sheet reports where the user dragged it with `onSnapChange`;
 * the parent decides. `closed` is reported through `onClose`, never by unmounting itself.
 *
 * Motion is the standard ease-out at `--dur-base`, not a spring: the one spring in the app
 * belongs to node entry. Reduced motion collapses it to an instant change via the tokens.
 *
 * The sheet always stays above the on-screen keyboard, so a field focused inside it is never
 * hidden behind it.
 */
export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name, and the visible header title unless `header` replaces it. */
  title: string;
  snap?: SheetSnap;
  onSnapChange?: (snap: SheetSnap) => void;
  /** Snaps the user can drag between. Include `closed` to allow swipe-to-dismiss. */
  snaps?: readonly SheetSnap[];
  modal?: boolean;
  /** Replaces the default title row. Stays draggable. `false` hides it (the body has its own). */
  header?: React.ReactNode;
  /**
   * Px reserved below the sheet, e.g. for a bottom action bar a non-modal sheet must not
   * cover. The keyboard still wins when it is taller.
   */
  bottomOffset?: number;
  /** Pinned under the scrolling body, above the safe area — primary actions go here. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function Sheet({
  open,
  onClose,
  title,
  snap = "half",
  onSnapChange,
  snaps = ["closed", "half", "full"],
  modal = true,
  header,
  footer,
  bottomOffset = 0,
  children,
}: SheetProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const { height: viewportHeight, keyboardInset } = useVisualViewport();
  const vh = viewportHeight || (typeof window !== "undefined" ? window.innerHeight : 800);

  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<{
    startY: number;
    startHeight: number;
    lastY: number;
    lastT: number;
    v: number;
  } | null>(null);

  const available = Math.max(0, vh - bottomOffset);
  const restingHeight = sheetHeightFor(snap === "closed" ? "half" : snap, available);
  const height = dragHeight ?? restingHeight;

  // Focus in on open, back to the opener on close. Modal only: a non-modal sheet must not
  // steal focus from the canvas every time the selection changes.
  useEffect(() => {
    if (!open || !modal) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    return () => returnFocus.current?.focus?.();
  }, [open, modal]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
      if (modal && event.key === "Tab") trapTab(event, panel.current);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, modal, onClose]);

  if (!open || typeof document === "undefined") return null;

  const settle = (next: SheetSnap) => {
    setDragHeight(null);
    if (next === "closed") onClose();
    else if (next !== snap) onSnapChange?.(next);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    // Let buttons inside the header work normally.
    if ((event.target as HTMLElement).closest("button, a, input, textarea, select")) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    drag.current = {
      startY: event.clientY,
      startHeight: height,
      lastY: event.clientY,
      lastT: event.timeStamp,
      v: 0,
    };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dt = Math.max(1, event.timeStamp - d.lastT);
    d.v = (event.clientY - d.lastY) / dt;
    d.lastY = event.clientY;
    d.lastT = event.timeStamp;
    const next = d.startHeight - (event.clientY - d.startY);
    setDragHeight(Math.max(0, Math.min(available, next)));
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (dragHeight === null) {
      // A tap on the grabber cycles upward, wrapping to the lowest open snap.
      const order = (["peek", "half", "full"] as const).filter((s) => snaps.includes(s));
      const index = order.indexOf(snap as (typeof order)[number]);
      settle(order[(index + 1) % order.length] ?? snap);
      return;
    }
    settle(resolveSheetSnap(dragHeight, d.v, available, snaps));
  };

  const dragHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: () => {
      drag.current = null;
      setDragHeight(null);
    },
  };

  return createPortal(
    <>
      {modal && (
        <div
          aria-hidden
          onClick={onClose}
          className="fixed inset-0 z-sheet animate-scrim-enter bg-[var(--scrim)]"
        />
      )}
      <div
        ref={panel}
        role="dialog"
        aria-modal={modal || undefined}
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`fixed inset-x-0 z-sheet flex animate-sheet-enter flex-col rounded-t-[var(--sheet-radius)] border-t border-subtle bg-raised shadow-lg focus-self ${
          dragHeight === null ? "transition-[height,bottom] duration-base ease-out" : ""
        }`}
        style={{ height, bottom: Math.max(keyboardInset, bottomOffset) }}
      >
        <div {...dragHandlers} className="touch-callout-none shrink-0 cursor-grab touch-none">
          <div className="flex justify-center pb-1 pt-2">
            <span aria-hidden className="h-1 w-9 rounded-full bg-[var(--border-strong)]" />
          </div>
          {header ?? (
            <div className="flex min-h-hit items-center gap-2 px-4">
              <h2
                id={titleId}
                className="min-w-0 flex-1 truncate text-base font-[var(--weight-emph)]"
              >
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="grid min-h-hit min-w-hit place-items-center rounded-full text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
              >
                <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path
                    d="M3 3l8 8M11 3l-8 8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          )}
          {header !== undefined && (
            <span id={titleId} className="sr-only">
              {title}
            </span>
          )}
        </div>
        <div className="scroll-contain min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-subtle px-4 pt-3 pb-[calc(var(--space-3)+var(--safe-bottom))]">
            {footer}
          </div>
        )}
        {!footer && <div aria-hidden className="shrink-0 pb-safe-bottom" />}
      </div>
    </>,
    document.body,
  );
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapTab(event: KeyboardEvent, root: HTMLElement | null) {
  if (!root) return;
  const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
