import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { allPlugins } from "@/core/registry";
import { Select } from "@/design/Select";
import { MODELS } from "./provider";

/** Auto-grow to six lines, then scroll. Roughly six × --leading-base plus the padding. */
const MAX_HEIGHT_PX = 168;

export type Scope = "scape" | "selection";

export interface ComposerProps {
  onSend: (request: string) => void;
  onCancel: () => void;
  busy: boolean;
  modelId: string;
  onModelChange: (modelId: string) => void;
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  /** Object types this generation may create. Empty means no constraint — every type. */
  types: string[];
  onTypesChange: (types: string[]) => void;
  selectionCount: number;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * The loudest element on screen, and everything else is arranged to make that true: a big
 * radius, an inset well, and the only filled accent button in the app.
 */
export function Composer({
  onSend,
  onCancel,
  busy,
  modelId,
  onModelChange,
  scope,
  onScopeChange,
  types,
  onTypesChange,
  selectionCount,
  disabled,
  placeholder = "Describe what you want on the canvas.",
}: ComposerProps) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT_PX ? "auto" : "hidden";
  }, [value]);

  const canSend = value.trim().length > 0 && !busy && !disabled;

  const send = () => {
    if (!canSend) return;
    onSend(value.trim());
    setValue("");
  };

  return (
    <div
      className={
        "w-full rounded-2xl border bg-inset transition-colors duration-fast ease-out " +
        (focused ? "border-focus" : "border-subtle")
      }
    >
      <textarea
        ref={textarea}
        rows={1}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          // Cmd+Enter sends. Plain Enter inserts a newline — briefs are usually more than
          // one line, and losing a half-written one to a stray keystroke is unforgivable.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={placeholder}
        aria-label="Prompt"
        // The well around it is what lights up on focus, so the field itself draws nothing.
        className="focus-self w-full resize-none bg-transparent px-4 pt-3 text-base text-fg placeholder:text-fg-tertiary disabled:opacity-50"
      />

      {/* Icon row, inside the well. */}
      <div className="flex items-center gap-1.5 px-3 pb-2.5 pt-1">
        <Select
          variant="pill"
          label="Scope"
          value={scope}
          onChange={(v) => onScopeChange(v as Scope)}
          options={[
            { value: "scape", label: "Whole scape" },
            {
              value: "selection",
              label: selectionCount ? `Selection (${selectionCount})` : "Selection",
            },
          ]}
          disabled={busy}
        />
        <TypePicker types={types} onChange={onTypesChange} disabled={busy} />
        <Select
          variant="pill"
          label="Model"
          value={modelId}
          onChange={onModelChange}
          options={MODELS.map((m) => ({ value: m.id, label: m.label, title: m.hint }))}
          disabled={busy}
        />

        <span className="mono ml-auto hidden sm:inline">{busy ? "streaming" : "⌘↵"}</span>

        {busy ? (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Stop generating"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface text-fg transition-colors duration-instant ease-out hover:bg-raised"
          >
            <span aria-hidden className="block h-2.5 w-2.5 rounded-[2px] bg-fg" />
          </button>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            aria-label="Send"
            className={
              "grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors " +
              "duration-instant ease-out " +
              (canSend
                ? "bg-accent text-on-accent hover:bg-accent-hover"
                : "bg-inset text-fg-tertiary")
            }
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path
                d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5l4 4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

const PILL =
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
function TypePicker({
  types,
  onChange,
  disabled,
}: {
  types: string[];
  onChange: (types: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const plugins = allPlugins();

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
  const label =
    selected.length === 0 || selected.length === plugins.length
      ? "All types"
      : selected
          .map((t) => plugins.find((p) => p.type === t)?.label ?? t)
          .join(" + ");

  const toggle = (type: string) => {
    const current = selected.length === 0 ? plugins.map((p) => p.type) : selected;
    const next = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type];
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
