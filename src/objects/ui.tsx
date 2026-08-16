import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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

const MARKDOWN_COMPONENTS = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    const safe = safeHref(href);
    return safe ? (
      <a href={safe} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    ) : (
      <>{children}</>
    );
  },
};

const INLINE_ELEMENTS = ["p", "strong", "em", "code", "a", "ul", "ol", "li", "blockquote", "del"];

export function RichText({
  value,
  className = "",
  ...props
}: { value: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={`rich-text ${className}`}>
      <ReactMarkdown
        allowedElements={INLINE_ELEMENTS}
        unwrapDisallowed
        components={MARKDOWN_COMPONENTS}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}

/**
 * The document-grade renderer: everything `RichText` allows, plus the structural elements a
 * written document needs — headings, tables, fenced code, rules.
 *
 * Kept separate rather than widening `RichText`, because a note and a journey step are short
 * captures: an `<h1>` inside a 220px card is a layout bug, not an expressive choice. Only the
 * scape block opts into this vocabulary.
 *
 * Images stay out on purpose. A published scape is served to strangers, and an `<img src>` is a
 * beacon that reports every reader to whoever authored the URL. Raw HTML never renders either —
 * react-markdown ignores it unless `rehype-raw` is installed, and it deliberately is not.
 */
export function DocumentText({
  value,
  className = "",
  ...props
}: { value: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={`rich-text doc-text ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        allowedElements={[
          ...INLINE_ELEMENTS,
          "h1",
          "h2",
          "h3",
          "h4",
          "hr",
          "pre",
          "table",
          "thead",
          "tbody",
          "tr",
          "th",
          "td",
        ]}
        unwrapDisallowed
        components={MARKDOWN_COMPONENTS}
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
  onEscape,
  autoFocus,
  className = "",
  rows,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  compact?: boolean;
  onBlur?: () => void;
  /** Escape while editing. Given here rather than left to the caller's `onKeyDown` so the
   *  key is also stopped from reaching the canvas, which reads Escape as "clear selection". */
  onEscape?: () => void;
  autoFocus?: boolean;
  className?: string;
  rows?: number;
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

  // An autofocused textarea puts the caret at character zero, which for a document means you
  // start typing above the title you were reading. Land at the end instead.
  useLayoutEffect(() => {
    if (!autoFocus || !ref.current) return;
    const end = ref.current.value.length;
    ref.current.setSelectionRange(end, end);
    // Mount only: after this the caret belongs to the user and to `pending`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  function apply(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
    next: TextSelection | null,
  ): boolean {
    if (!next) return false;
    pending.current = { start: next.start, end: next.end };
    onChange(next.value);
    event.preventDefault();
    // Claim the key, do not merely block its default.
    //
    // `src/app/Editor.tsx` binds Cmd+K to the command palette on `window`, and it tests for
    // the key *before* its "ignore keystrokes inside a text field" guard. React dispatches
    // from its root container, which is below `window`, so without this a Cmd+K in a note
    // body would insert the link and open the palette on top of it.
    event.stopPropagation();
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
      if (key === "b") apply(event, toggleWrap(state, "bold"));
      else if (key === "i") apply(event, toggleWrap(state, "italic"));
      else if (key === "k") apply(event, insertLink(state));
      return;
    }

    if (event.key === "Escape" && onEscape) {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
      return;
    }

    // Shift+Enter stays a plain newline, so there is always a way to break a line without
    // starting another list item.
    if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      apply(event, continueList(state));
    }
  }

  return (
    <textarea
      ref={ref}
      value={value}
      autoFocus={autoFocus}
      rows={rows}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      placeholder={placeholder}
      aria-label={placeholder ?? "Markdown"}
      className={`${FIELD_CLASS} resize-y font-mono ${compact ? "min-h-12 text-xs" : "min-h-20 text-sm"} ${className}`}
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
