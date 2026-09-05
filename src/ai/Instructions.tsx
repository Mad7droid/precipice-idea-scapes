import { useEffect, useRef, useState } from "react";

/**
 * Standing instructions — the user's persistent half of every prompt.
 *
 * Two of them exist and they are deliberately different things. The browser-wide set lives in
 * settings and says how *you* like generations to come out. The scape's set lives on the
 * document, travels with an export, and says what *this* document is for. Both are optional,
 * both are plain prose, and a scape with neither behaves exactly as it did before they existed.
 *
 * The controls are shared so the two never drift into different copy, different limits or
 * different affordances for the same idea.
 */

export const INSTRUCTIONS_PLACEHOLDER =
  "e.g. Write in British English. Keep notes to three bullets. Lead with the risk, not the plan.";

export function InstructionsField({
  id,
  value,
  onChange,
  maxLength,
  placeholder = INSTRUCTIONS_PLACEHOLDER,
  rows = 4,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  maxLength: number;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
}) {
  const remaining = maxLength - value.length;
  return (
    <>
      <textarea
        id={id}
        value={value}
        rows={rows}
        maxLength={maxLength}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="focus-self w-full resize-none rounded-md border border-subtle bg-inset px-3 py-2 text-sm text-fg placeholder:text-fg-tertiary"
      />
      {/* Only once it is close enough to matter. A counter on an empty field is noise. */}
      {remaining < maxLength / 4 && (
        <p className="mono mt-1 text-right">{remaining} characters left</p>
      )}
    </>
  );
}

/**
 * The composer's instructions control.
 *
 * A pill rather than a panel, and closed by default, because the overwhelming majority of
 * generations do not want one. The dot is the whole affordance: it says instructions are in
 * play without spending a line of the composer saying so.
 */
export function InstructionsPill({
  value,
  onChange,
  maxLength,
  globalInstructions,
  onEditGlobal,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  maxLength: number;
  /** Read-only here. Editing it belongs in settings, where it is not scoped to one document. */
  globalInstructions?: string;
  onEditGlobal?: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const root = useRef<HTMLDivElement>(null);

  // Committed on close rather than per keystroke: an instruction is written in one sitting,
  // and one undo step per character typed would bury whatever the user did before it.
  const commit = () => {
    setOpen(false);
    if (draft !== value) onChange(draft);
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    if (!open) setDraft(value);
  }, [value, open]);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) commitRef.current();
    };
    const escape = (event: KeyboardEvent) => {
      // Escape abandons the edit; clicking away keeps it. Same bargain as the resize grip.
      if (event.key === "Escape") {
        setDraft(value);
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open, value]);

  const set = value.trim().length > 0;
  const globalSet = (globalInstructions ?? "").trim().length > 0;

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? commit() : setOpen(true))}
        title="Standing instructions for generations in this scape"
        className={
          "mono flex cursor-pointer items-center gap-1.5 rounded-full border border-subtle " +
          "bg-transparent px-2.5 py-1 normal-case tracking-normal transition-colors " +
          "duration-instant ease-out hover:bg-hover hover:text-fg disabled:cursor-default " +
          "disabled:opacity-40 " +
          (set ? "text-fg" : "text-fg-secondary")
        }
      >
        {set && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
        Instructions
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Scape instructions"
          className="absolute bottom-full left-0 z-10 mb-1.5 w-[min(420px,calc(100vw-48px))] rounded-lg border border-subtle bg-raised p-3 shadow-md"
        >
          <label htmlFor="scape-instructions" className="mb-1 block text-xs text-fg-secondary">
            How AI should work in this scape
          </label>
          <InstructionsField
            id="scape-instructions"
            value={draft}
            onChange={setDraft}
            maxLength={maxLength}
            rows={5}
            autoFocus
          />
          <p className="mt-2 text-xs text-fg-tertiary">
            Applied to every generation here, and saved with the scape.
          </p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-fg-tertiary">
              {globalSet
                ? "Your settings instructions also apply."
                : "No instructions in settings."}
            </span>
            {onEditGlobal && (
              <button
                type="button"
                onClick={() => {
                  commit();
                  onEditGlobal();
                }}
                className="whitespace-nowrap rounded-sm px-1.5 py-0.5 text-xs text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
              >
                Edit those
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
