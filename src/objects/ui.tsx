import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared pieces for object plugins. This is a file, not a folder, so the registry glob
 * (`/src/objects/​*​/index.ts`) never tries to register it.
 */

/**
 * Text input that reports one value per pause, not one per keystroke.
 *
 * Inspectors are controlled by the store, but a controlled input that round-trips every
 * keystroke through a debounced dispatch drops characters. So the in-flight string is local
 * and the store is the source of truth whenever the field is not being typed into.
 */
export function useDebouncedText(
  value: string,
  commit: (next: string) => void,
  delay = 200,
): [string, (next: string) => void, () => void] {
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  // Accept external changes (undo, AI edits) only when the user is not mid-edit.
  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [value]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    if (!dirty.current) return;
    dirty.current = false;
  }, []);

  const onChange = useCallback(
    (next: string) => {
      setDraft(next);
      dirty.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        dirty.current = false;
        timer.current = undefined;
        commitRef.current(next);
      }, delay);
    },
    [delay],
  );

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return [draft, onChange, flush];
}

export function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h3 className="mono mb-2 mt-5 first:mt-0">{children}</h3>;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-fg-secondary">{label}</span>
      {children}
    </label>
  );
}

const FIELD_CLASS =
  "w-full rounded-md border border-subtle bg-inset px-2.5 py-1.5 text-fg " +
  "placeholder:text-fg-tertiary focus:border-focus focus:outline-none";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${FIELD_CLASS} ${props.className ?? ""}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea {...props} className={`${FIELD_CLASS} resize-y ${props.className ?? ""}`} />
  );
}

export function IconButton({
  label,
  onClick,
  children,
  danger,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={
        "grid h-6 w-6 shrink-0 place-items-center rounded-sm transition-colors " +
        "duration-instant ease-out hover:bg-hover " +
        (danger ? "text-fg-tertiary hover:text-danger" : "text-fg-tertiary hover:text-fg")
      }
    >
      {children}
    </button>
  );
}

/** Empty states inside a node say what to add, not how we feel about it. */
export function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-fg-tertiary">{children}</p>;
}

/** Clamp a string for `toText`, which the model reads for every unfocused object. */
export function clamp(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}
