import { useEffect, useRef } from "react";

/**
 * A small action menu.
 *
 * The canvas toolbar has a private one of these, but it closes on `onMouseLeave` — right for a
 * hover-driven toolbar, wrong for anything reached by keyboard, where it would dismiss itself
 * while you were arrowing through it. This one is focus-driven: arrows move, Escape closes and
 * hands focus back to whatever opened it, a click outside closes.
 *
 * Visually identical to the toolbar's, so the two read as one system.
 */
export function Menu({
  open,
  onClose,
  label,
  boundaryRef,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Names the menu for assistive tech — usually the trigger's own label. */
  label: string;
  /** Includes a separate trigger in the click-away boundary when the menu is a sibling of it. */
  boundaryRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Opening moves focus in, so the first Arrow or Enter lands somewhere sensible.
    root.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();

    const close = (event: MouseEvent) => {
      const boundary = boundaryRef?.current ?? root.current?.parentElement;
      if (!boundary?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open, onClose, boundaryRef]);

  if (!open) return null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    const items = [...(root.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])];
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focus = (next: number) => {
      event.preventDefault();
      items[(next + items.length) % items.length]?.focus();
    };

    if (event.key === "ArrowDown") focus(index + 1);
    else if (event.key === "ArrowUp") focus(index - 1);
    else if (event.key === "Home") focus(0);
    else if (event.key === "End") focus(items.length - 1);
    else if (event.key === "Escape" || event.key === "Tab") onClose();
  };

  return (
    <div
      ref={root}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="w-56 rounded-md border border-subtle bg-surface p-1 shadow-lg"
    >
      {children}
    </div>
  );
}

export function MenuItem({
  onSelect,
  caption,
  children,
}: {
  onSelect: () => void;
  /** One line on what the item does, when the label alone leaves a real question open. */
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="block w-full rounded-sm px-2 py-1.5 text-left transition-colors duration-instant ease-out hover:bg-hover focus-visible:bg-hover"
    >
      <span className="block text-fg">{children}</span>
      {caption && <span className="block text-xs text-fg-tertiary">{caption}</span>}
    </button>
  );
}
