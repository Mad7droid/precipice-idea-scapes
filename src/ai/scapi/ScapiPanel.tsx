import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { DotMatrix } from "@/ai/DotMatrix";
import type { ObjectId, ScapeObject } from "@/core/types";
import { answerFormatLabel, inferAnswerFormat } from "./answerFormat";
import { ObjectChip } from "./ObjectChip";
import type { ActivityEvent, SearchAvailability, Turn } from "./types";

/**
 * Scapi's panel — phase 1 shape.
 *
 * The spine only: a question, a streaming answer, an activity trail, and a way to stop it. The
 * reasoning disclosure, object chips and the shape header land in later phases and all hang off
 * state this already carries, so nothing here is scaffolding to be thrown away.
 */

export interface ScapiPanelProps {
  turns: Turn[];
  streaming: boolean;
  onSend: (question: string) => void;
  onCancel: () => void;
  onRetry?: () => void;
  onTurnIntoEdit?: (turn: Turn) => void;
  onObjectClick?: (id: ObjectId) => void;
  objects?: Record<ObjectId, ScapeObject>;
  webSearch?: boolean;
  onWebSearchChange?: (enabled: boolean) => void;
  searchAvailability?: SearchAvailability;
  restored?: boolean;
  suggestions?: string[];
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Markdown mapped onto the type scale rather than the browser's.
 *
 * Body text is 13px — the app's default UI size, not the 15px a reading surface would take.
 * This app runs tighter than most, and an answer panel that renders at a different size than
 * everything beside it reads as a different product bolted on.
 */
const markdownComponents: Components = {
  h1: ({ children }) => <h3 className="mt-7 text-lg font-[var(--weight-emph)]">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-7 text-lg font-[var(--weight-emph)]">{children}</h3>,
  h3: ({ children }) => (
    <h4 className="mt-6 text-[length:var(--text-base)] font-[var(--weight-emph)] text-fg">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="mt-4 text-[length:var(--text-base)] leading-relaxed text-fg first:mt-0">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="mt-5 list-disc space-y-4 pl-5 text-[length:var(--text-base)] leading-relaxed text-fg">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-5 list-decimal space-y-4 pl-5 text-[length:var(--text-base)] leading-relaxed text-fg">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-[var(--weight-emph)] text-fg">{children}</strong>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-fg-accent underline-offset-2 transition-colors duration-instant ease-out hover:underline"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full border-collapse text-[length:var(--text-base)] text-fg">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-subtle px-3 py-2 text-left align-top font-[var(--weight-ui)] text-fg-secondary">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-subtle px-3 py-2 align-top leading-relaxed">{children}</td>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-5 border-l-2 border-default pl-4 text-[length:var(--text-base)] leading-relaxed text-fg-secondary">
      {children}
    </blockquote>
  ),
};

export function ScapiPanel({
  turns,
  streaming,
  onSend,
  onCancel,
  disabled,
  placeholder,
  onRetry,
  onTurnIntoEdit,
  onObjectClick,
  objects = {},
  webSearch = true,
  onWebSearchChange,
  searchAvailability = "unknown",
  restored = false,
  suggestions = [],
}: ScapiPanelProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // A cheap signature of everything that can change the scroll height. Without a dependency
  // list this effect ran after *every* render and wrote `scrollTop` each time — a forced
  // synchronous layout per frame, which is its own source of stutter.
  const last = turns[turns.length - 1];
  const growth = `${turns.length}:${last?.body.length ?? 0}:${last?.reasoning.length ?? 0}:${last?.activity.length ?? 0}`;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [growth]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    // Follow the stream, but yield the moment the user scrolls away. A panel that drags you
    // back to the bottom while you are reading a table is worse than one that never follows.
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div
        ref={scroller}
        onScroll={onScroll}
        // The browser's own scroll anchoring fights an imperative `scrollTop`, and the two
        // together produce exactly the jitter this panel is trying to avoid.
        style={{ overflowAnchor: "none" }}
        className="min-h-0 flex-1 overflow-auto p-4"
      >
        {restored && (
          <p className="mb-3 rounded-md bg-inset px-3 py-2 text-xs text-fg-secondary">
            Earlier answers are shown for reference. This conversation starts fresh from here.
          </p>
        )}
        {turns.length === 0 ? (
          <EmptyState suggestions={suggestions} onSend={onSend} />
        ) : (
          <ol className="space-y-5">
            {turns.map((turn, index) => (
              <li key={turn.id}>
                <TurnView
                  turn={turn}
                  objects={objects}
                  onObjectClick={onObjectClick}
                  {...(onTurnIntoEdit ? { onTurnIntoEdit } : {})}
                  {...(index === turns.length - 1 && !streaming && onRetry ? { onRetry } : {})}
                />
              </li>
            ))}
          </ol>
        )}
      </div>

      <ScapiComposer
        streaming={streaming}
        onSend={onSend}
        onCancel={onCancel}
        webSearch={webSearch}
        onWebSearchChange={onWebSearchChange}
        searchAvailability={searchAvailability}
        {...(disabled === undefined ? {} : { disabled })}
        {...(placeholder === undefined ? {} : { placeholder })}
      />
    </div>
  );
}

/** An empty screen is an invitation to act, so the copy is an instruction, not a greeting. */
function EmptyState({
  suggestions,
  onSend,
}: {
  suggestions: string[];
  onSend: (question: string) => void;
}) {
  return (
    <div className="mt-6">
      <p className="text-base font-[var(--weight-emph)] text-fg">Ask about this scape.</p>
      <p className="mt-1 text-sm text-fg-secondary">
        Scapi can read every object on the canvas. It answers questions; it never changes the
        document.
      </p>
      {suggestions.length > 0 && (
        <div className="mt-4 grid gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onSend(suggestion)}
              className="animate-home-enter rounded-lg border border-subtle bg-raised px-3 py-2 text-left text-sm text-fg transition-colors duration-instant ease-out hover:bg-hover"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Memoised on the turn object.
 *
 * Only the streaming turn gets a new identity — `updateLast` replaces one element and leaves
 * the rest alone — so finished turns stop re-rendering, and stop re-parsing their markdown,
 * the moment they finish. Without this, turn ten re-parses turns one to nine on every frame.
 */
const TurnView = memo(function TurnView({
  turn,
  objects,
  onObjectClick,
  onRetry,
  onTurnIntoEdit,
}: {
  turn: Turn;
  objects: Record<ObjectId, ScapeObject>;
  onObjectClick?: (id: ObjectId) => void;
  onRetry?: () => void;
  onTurnIntoEdit?: (turn: Turn) => void;
}) {
  const streaming = turn.status === "streaming";
  const summary = summarise(turn.activity);
  const label = answerFormatLabel(inferAnswerFormat(turn.question));

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-lg bg-inset px-3 py-2 text-sm text-fg">{turn.question}</p>
      </div>

      {turn.reasoning && <ReasoningDisclosure turn={turn} />}

      {streaming ? (
        <WorkingDisclosure activity={turn.activity} hasAnswer={Boolean(turn.body)} />
      ) : (
        summary && <p className="mono px-1 text-fg-tertiary">{summary}</p>
      )}

      {/* Research can resolve before the model starts writing. Do not make its evidence wait
          behind the final prose. */}
      {!turn.body && turn.sources.length > 0 && <Sources sources={turn.sources} title="Research" />}

      {turn.body && (
        <AnswerCard>
          <p className="mb-4 text-sm font-[var(--weight-emph)] text-fg-secondary">{label}</p>
          <AnswerBody body={turn.body} objects={objects} onObjectClick={onObjectClick} />
          {turn.status !== "streaming" && (
            <TurnActions
              body={turn.body}
              turn={turn}
              onRetry={onRetry}
              onTurnIntoEdit={onTurnIntoEdit}
            />
          )}
          {turn.sources.length > 0 && <Sources sources={turn.sources} title="Sources" />}
        </AnswerCard>
      )}

      {turn.status === "error" && turn.error && (
        <div className="rounded-md border border-subtle bg-raised p-3">
          <p className="text-sm font-[var(--weight-emph)] text-danger">{turn.error.message}</p>
          <p className="mt-0.5 text-xs text-fg-secondary">{turn.error.detail}</p>
        </div>
      )}

      {turn.status === "cancelled" && <p className="mono px-1 text-fg-tertiary">stopped</p>}
    </div>
  );
});

/** The card reserves its complete final layout before its text starts to reveal. */
function AnswerCard({ children }: { children: React.ReactNode }) {
  return (
    <article className="rounded-lg border border-subtle bg-raised p-5 text-fg shadow-sm">
      {children}
    </article>
  );
}

/**
 * Separately memoised so that an activity or source event — which arrives while the body is
 * unchanged — does not re-parse the markdown.
 */
const AnswerBody = memo(function AnswerBody({
  body,
  objects,
  onObjectClick,
}: {
  body: string;
  objects: Record<ObjectId, ScapeObject>;
  onObjectClick?: (id: ObjectId) => void;
}) {
  const components: Components = {
    ...markdownComponents,
    code: ({ children }) => {
      const id = String(children).replace(/\n$/, "");
      const object = objects[id];
      return object ? (
        <ObjectChip
          object={object}
          {...(onObjectClick ? { onClick: () => onObjectClick(id) } : {})}
        />
      ) : (
        <code className="mono rounded-xs bg-inset px-1 py-0.5 normal-case tracking-normal text-fg-secondary">
          {children}
        </code>
      );
    },
  };
  return <ReactMarkdown components={components}>{body}</ReactMarkdown>;
});

/**
 * Thinking is useful evidence while Scapi is waiting, then yields to the answer as soon as it
 * exists. The grid-row transition avoids measuring a stream that is still growing.
 */
function ReasoningDisclosure({ turn }: { turn: Turn }) {
  const hasAnswer = turn.body.length > 0;
  const [expanded, setExpanded] = useState(!hasAnswer);

  useEffect(() => {
    if (hasAnswer) setExpanded(false);
  }, [hasAnswer]);

  return (
    <section className="rounded-md bg-inset">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-fg-secondary transition-colors duration-instant ease-out hover:text-fg"
      >
        <span>Approach</span>
        <span aria-hidden className="mono">
          {expanded ? "−" : "+"}
        </span>
      </button>
      <div
        className="grid transition-[grid-template-rows,opacity] duration-base ease-out"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr", opacity: expanded ? 1 : 0 }}
      >
        <div className="min-h-0 overflow-hidden">
          <p className="border-l-2 border-default px-3 pb-3 text-xs leading-relaxed text-fg-secondary">
            {turn.reasoning}
          </p>
        </div>
      </div>
    </section>
  );
}

function TurnActions({
  body,
  turn,
  onRetry,
  onTurnIntoEdit,
}: {
  body: string;
  turn: Turn;
  onRetry?: () => void;
  onTurnIntoEdit?: (turn: Turn) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard access is a browser permission; leaving the control unchanged is preferable
      // to a toast for a small, recoverable action.
    }
  };

  return (
    <div className="mt-3 flex items-center gap-3 border-t border-subtle pt-2 text-xs text-fg-secondary">
      <button
        type="button"
        onClick={() => void copy()}
        className="transition-colors duration-instant ease-out hover:text-fg"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="transition-colors duration-instant ease-out hover:text-fg"
        >
          Retry
        </button>
      )}
      {onTurnIntoEdit && turn.status === "done" && (
        <button
          type="button"
          onClick={() => onTurnIntoEdit(turn)}
          className="transition-colors duration-instant ease-out hover:text-fg"
        >
          Turn into an edit
        </button>
      )}
    </div>
  );
}

function Sources({ sources, title }: { sources: Turn["sources"]; title: string }) {
  return (
    <section className="mt-3 border-t border-subtle pt-3" aria-live="polite">
      <h4 className="text-xs font-[var(--weight-emph)] text-fg-secondary">{title}</h4>
      <ol className="mt-1.5 space-y-1 text-xs">
        {sources.map((source, index) => {
          let host = source.url;
          try {
            host = new URL(source.url).hostname;
          } catch {
            // A provider source is normally a URL; retain its visible value if it is not.
          }
          return (
            <li key={source.id} className="flex gap-2">
              <span className="mono text-fg-tertiary">{index + 1}</span>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 text-fg-accent hover:underline"
              >
                <span className="block truncate">{source.title}</span>
                <span className="mono block truncate text-fg-tertiary">{host}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * What Scapi has done so far, in order, with the current step live.
 *
 * Every label is literally what happened. The reference says "Almost there…", which is filler
 * by this app's own copy rule — and a wait is far less annoying when it is legible, so the real
 * activity is better material than a platitude anyway.
 */
function WorkingDisclosure({
  activity,
  hasAnswer,
}: {
  activity: ActivityEvent[];
  hasAnswer: boolean;
}) {
  const [expanded, setExpanded] = useState(!hasAnswer);

  useEffect(() => {
    if (hasAnswer) setExpanded(false);
  }, [hasAnswer]);

  const done = activity.slice(0, -1);
  const current = activity[activity.length - 1];

  return (
    <section className="rounded-md bg-inset" aria-live="polite">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-fg-secondary transition-colors duration-instant ease-out hover:text-fg"
      >
        <span>{hasAnswer ? "Working" : "Working…"}</span>
        <span className="min-w-0 truncate pl-3 text-right">
          {current ? activityLabel(current) : "connecting"}
        </span>
        <span aria-hidden className="mono pl-2">
          {expanded ? "−" : "+"}
        </span>
      </button>
      <div
        className="grid transition-[grid-template-rows,opacity] duration-base ease-out"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr", opacity: expanded ? 1 : 0 }}
      >
        <div className="min-h-0 overflow-hidden px-3 pb-3">
          <div className="space-y-1 border-l-2 border-default pl-3">
            {done.map((event, i) => (
              <p key={i} className="mono normal-case tracking-normal text-fg-tertiary">
                <span aria-hidden className="mr-1.5">
                  ✓
                </span>
                {activityLabel(event)}
              </p>
            ))}
            <DotMatrix label={current ? activityLabel(current) : "connecting"} />
          </div>
        </div>
      </div>
    </section>
  );
}

function activityLabel(event: ActivityEvent): string {
  switch (event.kind) {
    case "reading-scape":
      return `reading the canvas — ${event.objects} object${event.objects === 1 ? "" : "s"}`;
    case "thinking":
      return "thinking it through";
    case "reading-canvas":
      return `searching the canvas for "${event.query}"`;
    case "reading-objects":
      return `reading ${event.ids.length} object${event.ids.length === 1 ? "" : "s"} in full`;
    case "searching":
      return `searching the web for "${event.query}"`;
    case "read-sources":
      return `read ${event.count} source${event.count === 1 ? "" : "s"}`;
    case "writing":
      return "writing the answer";
  }
}

/**
 * The finished trail, compressed to the parts worth keeping — which is provenance, not
 * narration. Nothing at all when the turn was answered straight from the canvas, because
 * "it read the scape and then answered" is the boring default and does not need a line.
 */
function summarise(activity: ActivityEvent[]): string | null {
  let objects = 0;
  let canvasSearches = 0;
  let webSearches = 0;
  let sources = 0;

  for (const event of activity) {
    if (event.kind === "reading-objects") objects += event.ids.length;
    if (event.kind === "reading-canvas") canvasSearches += 1;
    if (event.kind === "searching") webSearches += 1;
    if (event.kind === "read-sources") sources = Math.max(sources, event.count);
  }

  const parts: string[] = [];
  if (canvasSearches)
    parts.push(`${canvasSearches} canvas search${canvasSearches === 1 ? "" : "es"}`);
  if (objects) parts.push(`${objects} object${objects === 1 ? "" : "s"} read`);
  if (webSearches) parts.push(`${webSearches} web search${webSearches === 1 ? "" : "es"}`);
  if (sources) parts.push(`${sources} source${sources === 1 ? "" : "s"}`);

  return parts.length > 0 ? parts.join(" · ") : null;
}

function ScapiComposer({
  streaming,
  onSend,
  onCancel,
  disabled,
  placeholder,
  webSearch,
  onWebSearchChange,
  searchAvailability,
}: {
  streaming: boolean;
  onSend: (question: string) => void;
  onCancel: () => void;
  disabled?: boolean;
  placeholder?: string;
  webSearch: boolean;
  onWebSearchChange?: (enabled: boolean) => void;
  searchAvailability: SearchAvailability;
}) {
  const [draft, setDraft] = useState("");
  const canSend = draft.trim().length > 0 && !disabled;

  const submit = () => {
    if (!canSend) return;
    onSend(draft);
    setDraft("");
  };

  return (
    <div className="shrink-0 border-t border-subtle p-3">
      <div className="rounded-2xl border border-subtle bg-inset p-2 transition-colors duration-fast ease-out focus-within:border-focus">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          disabled={disabled}
          placeholder={placeholder ?? "Ask about this scape…"}
          aria-label="Ask Scapi"
          className="focus-self w-full resize-none bg-transparent px-1.5 py-1 text-sm text-fg outline-none placeholder:text-fg-tertiary"
        />
        <div className="flex items-center justify-between px-1.5">
          <div className="flex items-center gap-2">
            {onWebSearchChange && (
              <label className="flex items-center gap-1.5 text-xs text-fg-secondary">
                <input
                  type="checkbox"
                  checked={webSearch && searchAvailability !== "unavailable"}
                  onChange={(event) => onWebSearchChange(event.target.checked)}
                  disabled={searchAvailability === "unavailable"}
                  className="accent-accent"
                />
                Search web
              </label>
            )}
            <span className="mono text-fg-tertiary">⌘↵</span>
          </div>
          {streaming ? (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Stop"
              className="grid h-7 w-7 place-items-center rounded-full bg-accent text-fg-on-accent transition-colors duration-fast ease-out hover:bg-accent-hover"
            >
              <span aria-hidden className="block h-2.5 w-2.5 rounded-xs bg-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label="Ask"
              className="grid h-7 w-7 place-items-center rounded-full bg-accent text-fg-on-accent transition-colors duration-instant ease-out hover:bg-accent-hover disabled:bg-inset disabled:text-fg-tertiary"
            >
              <span aria-hidden>↑</span>
            </button>
          )}
        </div>
      </div>
      {searchAvailability === "unavailable" && (
        <p className="mt-1.5 px-1 text-xs text-fg-secondary">
          Web search isn’t enabled for this API key. Turn it on in the Anthropic Console.
        </p>
      )}
    </div>
  );
}
