import { useEffect, useRef, useState } from "react";
import { allPlugins } from "@/core/registry";
import type { RouteDimension } from "./router/types";

/** Shared pieces of the composer: route-lock sets, the pill style and the type picker. */

export const NO_LOCKS: ReadonlySet<RouteDimension> = new Set();
export const ALL_LOCKS: ReadonlySet<RouteDimension> = new Set([
  "intent",
  "scope",
  "types",
  "tier",
  "webSearch",
  "command",
]);
export const DIMENSION_NAMES: Record<RouteDimension, string> = {
  intent: "mode",
  scope: "scope",
  types: "types",
  tier: "model",
  webSearch: "web search",
  command: "command",
};

export const PILL =
  "mono cursor-pointer rounded-full border border-subtle bg-transparent px-2.5 py-1 " +
  "normal-case tracking-normal text-fg-secondary transition-colors duration-instant " +
  "ease-out hover:bg-hover hover:text-fg disabled:cursor-default disabled:opacity-40";

/**
 * Constrains what the model is allowed to create.
 *
 * A multi-select is the wrong control here — the common case is "everything", and the second
 * most common is "only notes". So this is a set of toggles behind a pill that names the
 * current answer in plain words. An empty set means unconstrained rather than "nothing",
 * which keeps the default free of any prompt change at all.
 */
export function TypePicker({
  types,
  onChange,
  disabled,
  availableTypes,
}: {
  types: string[];
  onChange: (types: string[]) => void;
  disabled?: boolean;
  /** Restricts the menu itself. A mind map never offers to create a wireframe. */
  availableTypes?: string[];
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const all = allPlugins();
  const plugins =
    availableTypes && availableTypes.length > 0
      ? all.filter((p) => availableTypes.includes(p.type))
      : all;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const selected = types.filter((t) => plugins.some((p) => p.type === t));
  const names = (list: string[]) =>
    list.map((t) => plugins.find((p) => p.type === t)?.label ?? t).join(" + ");
  const label =
    selected.length === 0 || selected.length === plugins.length
      ? // "All types" is a lie when the scape's starter has already narrowed the menu — a mind
        // map's picker offering "All types" reads as though a wireframe is one keystroke away.
        plugins.length < all.length
        ? names(plugins.map((p) => p.type))
        : "All types"
      : names(selected);

  const toggle = (type: string) => {
    const current = selected.length === 0 ? plugins.map((p) => p.type) : selected;
    const next = current.includes(type) ? current.filter((t) => t !== type) : [...current, type];
    // Every type on is the same as no constraint, and so is none: refusing to create
    // anything is never what someone means by unticking the last box.
    onChange(next.length === 0 || next.length === plugins.length ? [] : next);
  };

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={PILL}
        title="Which object types this generation may create"
      >
        {label}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-10 mb-1.5 min-w-40 rounded-md border border-subtle bg-raised p-1 shadow-md">
          {plugins.map((plugin) => {
            const on = selected.length === 0 || selected.includes(plugin.type);
            return (
              <label
                key={plugin.type}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(plugin.type)}
                  className="accent-[var(--accent)]"
                />
                {plugin.label}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
