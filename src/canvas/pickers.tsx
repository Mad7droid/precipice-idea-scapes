import { useEffect, useMemo, useRef, useState } from "react";
import { allPlugins } from "@/core/registry";
import type { ObjectId } from "@/core/types";

/**
 * The two menus the canvas opens at a point: what to add, and what to connect to.
 *
 * Both are positioned in screen coordinates and both close on Escape, on a click outside, and
 * on pick. They live here rather than in Canvas.tsx because the canvas file is already the
 * busiest in the workstream and neither of these needs anything from it but a callback.
 */

const PANEL =
  "z-popover fixed w-56 overflow-hidden rounded-md border border-subtle bg-surface shadow-lg";

const ROW =
  "flex w-full items-center gap-2 px-2 py-1.5 text-left text-fg transition-colors " +
  "duration-instant ease-out hover:bg-hover";

/** The canvas toolbar's column on the right edge (button, inset, gap). */
const RIGHT_RAIL = 56;

/**
 * Keeps a menu inside the window when it is opened near the right or bottom edge, and clear
 * of the toolbar rail so it never covers the zoom controls.
 */
function clampToViewport(x: number, y: number, width = 224, height = 260) {
  if (typeof window === "undefined") return { left: x, top: y };
  return {
    left: Math.max(8, Math.min(x, window.innerWidth - width - 8 - RIGHT_RAIL)),
    top: Math.min(y, window.innerHeight - height - 8),
  };
}

function useDismiss(onClose: () => void) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    // Deferred: the same click that opened the menu is still propagating.
    const timer = setTimeout(() => document.addEventListener("mousedown", click), 0);
    document.addEventListener("keydown", key);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", click);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);

  return root;
}

function TypeDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ background: `var(${color})` }}
    />
  );
}

export interface AddPaletteProps {
  x: number;
  y: number;
  /** Set when the palette was opened by dragging a connection into empty space. */
  connectingFrom?: string | undefined;
  onPick: (objectType: string) => void;
  onClose: () => void;
}

/**
 * What to add, at the point you asked for it.
 *
 * Reached three ways — the toolbar, a double-click on empty canvas, and dropping a connection
 * into empty space. The third is the important one: it is how a mind map actually gets built,
 * and it creates the object and the relationship in a single transaction.
 */
export function AddPalette({ x, y, connectingFrom, onPick, onClose }: AddPaletteProps) {
  const root = useDismiss(onClose);
  const plugins = allPlugins();
  const list = useRef<HTMLDivElement>(null);

  // Keyboard first: focus lands on the first choice, arrows move, Enter picks.
  useEffect(() => {
    list.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      buttons[(index + step + buttons.length) % buttons.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus();
    }
    // Arrow keys must not reach the canvas, where they nudge the selection.
    event.stopPropagation();
  };

  const heading = connectingFrom ? "connect to new" : "add";
  return (
    <div ref={root} className={PANEL} style={clampToViewport(x, y, 224, 40 + plugins.length * 34)}>
      <p className="mono px-2 pb-1 pt-2" aria-hidden>
        {heading}
      </p>
      <div
        ref={list}
        role="menu"
        aria-label={connectingFrom ? "Connect to a new block" : "Add a block"}
        onKeyDown={onKeyDown}
        className="p-1 pt-0"
      >
        {plugins.map((plugin) => (
          <button
            key={plugin.type}
            type="button"
            role="menuitem"
            onClick={() => onPick(plugin.type)}
            className={ROW + " focus-visible:bg-hover"}
          >
            <TypeDot color={plugin.color} />
            {plugin.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface ConnectMenuProps {
  x: number;
  y: number;
  options: { id: ObjectId; title: string; type: string }[];
  onPick: (id: ObjectId) => void;
  onClose: () => void;
}

/**
 * Connect this object to an existing one.
 *
 * Filterable, because the unfiltered version listed every object in the scape and stopped
 * being usable somewhere around the fortieth. Matches on title and on id — the id is printed
 * on every card, so it is a reasonable thing to type.
 */
export function ConnectMenu({ x, y, options, onPick, onClose }: ConnectMenuProps) {
  const root = useDismiss(onClose);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.title.toLowerCase().includes(q) || o.id.toLowerCase().includes(q),
    );
  }, [options, query]);

  useEffect(() => setActive(0), [query]);

  const colorFor = (type: string) =>
    allPlugins().find((p) => p.type === type)?.color ?? "--border-strong";

  return (
    <div ref={root} className={PANEL} style={clampToViewport(x, y, 224, 300)}>
      <p className="mono px-2 pb-1 pt-2">connect to</p>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && matches[active]) {
            e.preventDefault();
            onPick(matches[active].id);
          }
        }}
        placeholder="Filter"
        aria-label="Filter objects"
        className="focus-self mx-1 mb-1 w-[calc(100%-8px)] rounded-sm border border-subtle bg-inset px-2 py-1 text-fg placeholder:text-fg-tertiary"
      />
      {matches.length === 0 ? (
        <p className="px-2 pb-2 text-xs text-fg-tertiary">Nothing matches.</p>
      ) : (
        <ul className="max-h-56 overflow-auto p-1 pt-0">
          {matches.map((o, i) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => onPick(o.id)}
                onMouseEnter={() => setActive(i)}
                className={ROW + (i === active ? " bg-hover" : "")}
              >
                <TypeDot color={colorFor(o.type)} />
                <span className="truncate">{o.title || "Untitled"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
