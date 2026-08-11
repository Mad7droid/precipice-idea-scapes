import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { continueList, insertLink, toggleWrap, type TextSelection } from "./markdownText";

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
  const draftRef = useRef(value);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  // Accept external changes (undo, AI edits) only when the user is not mid-edit.
  useEffect(() => {
    if (!dirty.current) {
      draftRef.current = value;
      setDraft(value);
    }
  }, [value]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    if (!dirty.current) return;
    dirty.current = false;
    commitRef.current(draftRef.current);
  }, []);

  const onChange = useCallback(
    (next: string) => {
      draftRef.current = next;
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

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (dirty.current) {
        dirty.current = false;
        commitRef.current(draftRef.current);
      }
    },
    [],
  );

  return [draft, onChange, flush];
}

export function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h3 className="mono mb-2 mt-5 first:mt-0">{children}</h3>;
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  /** Set when the current draft value was rejected or clamped — names what happened, not
   * just that something went wrong. */
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-fg-secondary">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  );
}

const FIELD_CLASS =
  "w-full rounded-md border border-subtle bg-inset px-2.5 py-1.5 text-fg " +
  "placeholder:text-fg-tertiary focus:border-focus focus-self";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${FIELD_CLASS} ${props.className ?? ""}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${FIELD_CLASS} resize-y ${props.className ?? ""}`} />;
}

// Lives in a React-free module so the PDF export can strip Markdown without pulling
// react-markdown into the export chunk. Re-exported here because this is where callers
// already look for it.
export { richTextToPlainText } from "./markdownText";

function safeHref(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function RichText({
  value,
  className = "",
  ...props
}: { value: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={`rich-text ${className}`}>
      <ReactMarkdown
        allowedElements={["p", "strong", "em", "code", "a", "ul", "ol", "li", "blockquote", "del"]}
        unwrapDisallowed
        components={{
          a: ({ href, children }) => {
            const safe = safeHref(href);
            return safe ? (
              <a href={safe} target="_blank" rel="noopener noreferrer nofollow">
                {children}
              </a>
            ) : (
              <>{children}</>
            );
          },
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}

/**
 * A textarea that knows four things about Markdown: bold, italic, link, and that a list
 * should keep going.
 *
 * Deliberately not a WYSIWYG surface. The value is Markdown source, stored in the plugin's
 * existing `body: z.string()`, which is why there is no migration and why a `.scape` stays
 * readable in a text editor. What the shortcuts buy is that you never have to type the
 * syntax — which is the entire difference between this and a plain text box.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  compact = false,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  compact?: boolean;
  onBlur?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Where the caret has to land once React has re-rendered with the new value. Setting it
  // during the event handler is pointless: the controlled value has not been applied yet.
  const pending = useRef<{ start: number; end: number } | null>(null);

  useLayoutEffect(() => {
    const target = pending.current;
    if (!target || !ref.current) return;
    pending.current = null;
    ref.current.setSelectionRange(target.start, target.end);
  }, [value]);

  function apply(next: TextSelection | null): boolean {
    if (!next) return false;
    pending.current = { start: next.start, end: next.end };
    onChange(next.value);
    return true;
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const field = event.currentTarget;
    const state: TextSelection = {
      value: field.value,
      start: field.selectionStart,
      end: field.selectionEnd,
    };

    // Cmd on macOS, Ctrl elsewhere. Never both, or Ctrl+Cmd+B would fire twice.
    const shortcut = event.metaKey !== event.ctrlKey && !event.altKey;
    if (shortcut) {
      const key = event.key.toLowerCase();
      if (key === "b" && apply(toggleWrap(state, "bold"))) return event.preventDefault();
      if (key === "i" && apply(toggleWrap(state, "italic"))) return event.preventDefault();
      if (key === "k" && apply(insertLink(state))) return event.preventDefault();
      return;
    }

    // Shift+Enter stays a plain newline, so there is always a way to break a line without
    // starting another list item.
    if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      if (apply(continueList(state))) event.preventDefault();
    }
  }

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      placeholder={placeholder}
      aria-label={placeholder ?? "Markdown"}
      className={`${FIELD_CLASS} resize-y font-mono ${compact ? "min-h-12 text-xs" : "min-h-20 text-sm"}`}
    />
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
