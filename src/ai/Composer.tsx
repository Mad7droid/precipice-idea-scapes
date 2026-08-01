import { useLayoutEffect, useRef, useState } from "react";
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
        <Select
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

function Select({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; title?: string }>;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="mono cursor-pointer rounded-full border border-subtle bg-transparent px-2.5 py-1 normal-case tracking-normal text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg disabled:opacity-40"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} title={option.title}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
