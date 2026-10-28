import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Scapi } from "@/components/scapi/Scapi";
import type { ObjectId, ScapeObject } from "@/core/types";
import type { ScapiMood } from "./useScapiMood";
import { answerFormatLabel, inferAnswerFormat } from "./answerFormat";
import { ObjectChip } from "./ObjectChip";
import type { SearchAvailability, Turn } from "./types";
import { ScapiComposer } from "./ScapiComposer";
import {
  ReasoningDisclosure,
  TurnActions,
  Sources,
  WorkingDisclosure,
  ModelTag,
  statusFor,
  summarise,
} from "./TurnParts";

export { AnswerError, errorStatus } from "./TurnParts";

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
  /**
   * The shared draft. Both composers — this one and the canvas bar — read and write the same
   * text, so opening or closing the panel never loses a half-written question.
   */
  value?: string;
  onValueChange?: (value: string) => void;
  /** Rendered inside the composer, in place of this panel's own plain textarea. */
  composer?: React.ReactNode;
  /**
   * What a running edit is doing, rendered at the end of the transcript rather than pinned
   * above it. An edit is a turn in the same conversation, so it reads in sequence with the
   * answers around it and scrolls with them.
   */
  activity?: React.ReactNode;
  /**
   * Scapi's live state. One mascot stays at the end of the transcript after a turn settles,
   * returning to friendly idle reactions. Status text and error cards carry the meaning.
   */
  mood?: ScapiMood;
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
  li: ({ children }) => (String(children).trim() ? <li className="pl-1">{children}</li> : null),
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
    <section className="mt-5" aria-label="Comparison table">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-fg-tertiary">
        <span>Comparison</span>
        <span>Scroll sideways to see all columns</span>
      </div>
      <div className="overflow-x-auto pb-2">
        <table className="min-w-full border-collapse text-[length:var(--text-base)] text-fg">
          {children}
        </table>
      </div>
    </section>
  ),
  th: ({ children }) => (
    <th className="min-w-36 border-b border-subtle px-3 py-2 text-left align-top font-[var(--weight-ui)] text-fg-secondary">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="min-w-36 border-b border-subtle px-3 py-2 align-top leading-relaxed">
      {children}
    </td>
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
  value,
  onValueChange,
  composer,
  activity,
  mood,
}: ScapiPanelProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atLatest, setAtLatest] = useState(true);

  // A cheap signature of everything that can change the scroll height. Without a dependency
  // list this effect ran after *every* render and wrote `scrollTop` each time — a forced
  // synchronous layout per frame, which is its own source of stutter.
  const last = turns[turns.length - 1];
  const live =
    turns.length > 0 || activity
      ? (mood ?? { state: streaming || activity ? "thinking" : "idle", reactionKey: 0 })
      : null;
  const growth = `${turns.length}:${last?.body.length ?? 0}:${last?.reasoning.length ?? 0}:${last?.activity.length ?? 0}:${activity ? 1 : 0}:${live ? 1 : 0}`;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) {
      el.scrollTop = el.scrollHeight;
      setAtLatest(true);
    }
  }, [growth]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    // Follow the stream, but yield the moment the user scrolls away. A panel that drags you
    // back to the bottom while you are reading a table is worse than one that never follows.
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    setAtLatest(stick.current);
  };

  const jumpToLatest = () => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stick.current = true;
    setAtLatest(true);
  };
  const liveStatus = statusFor(last, streaming);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-surface">
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {liveStatus}
      </p>
      {/*
        The scroller and its overlay share a wrapper so that "jump to latest" can hang off the
        bottom of the *transcript* rather than off the panel. It used to be offset from the
        panel's own bottom edge, which put it inside the composer as soon as the composer grew
        a second row of controls.
      */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          onScroll={onScroll}
          // The browser's own scroll anchoring fights an imperative `scrollTop`, and the two
          // together produce exactly the jitter this panel is trying to avoid.
          style={{ overflowAnchor: "none" }}
          className="h-full overflow-auto p-4"
        >
          {restored && (
            <p className="mb-3 rounded-md bg-inset px-3 py-2 text-xs text-fg-secondary">
              Earlier answers are shown for reference. This conversation starts fresh from here.
            </p>
          )}
          {turns.length === 0 && !activity ? (
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
          {activity && <div className="mt-5">{activity}</div>}
          {live && (
            <Scapi
              size={56}
              state={live.state}
              reactionKey={live.reactionKey}
              playful
              idleReactions
              className="mt-3"
            />
          )}
        </div>

        {!atLatest && turns.length > 0 && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-3 right-4 rounded-full border border-subtle bg-raised px-3 py-1.5 text-xs text-fg shadow-md transition-colors duration-instant ease-out hover:bg-hover active:scale-[0.98]"
          >
            Jump to latest
          </button>
        )}
      </div>

      {composer ?? (
        <ScapiComposer
          streaming={streaming}
          onSend={onSend}
          onCancel={onCancel}
          webSearch={webSearch}
          onWebSearchChange={onWebSearchChange}
          searchAvailability={searchAvailability}
          modelId={turns[turns.length - 1]?.modelId ?? ""}
          {...(value === undefined ? {} : { value })}
          {...(onValueChange === undefined ? {} : { onValueChange })}
          {...(disabled === undefined ? {} : { disabled })}
          {...(placeholder === undefined ? {} : { placeholder })}
        />
      )}
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
      <Scapi size={96} playful className="mb-3" />
      <p className="text-base font-[var(--weight-emph)] text-fg">Ask about this scape.</p>
      <p className="mt-1 text-sm text-fg-secondary">
        Scapi can read every object on the canvas. Ask answers questions without changing your work.
        Choose Edit to make changes.
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
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!streaming) return;
    setPaused(false);
    const timer = window.setTimeout(() => setPaused(true), 700);
    return () => window.clearTimeout(timer);
  }, [streaming, turn.body, turn.activity.length]);
  const summary = summarise(turn.activity);
  const label = answerFormatLabel(inferAnswerFormat(turn.question));

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-lg bg-inset px-3 py-2 text-sm text-fg">{turn.question}</p>
      </div>

      {turn.reasoning && <ReasoningDisclosure turn={turn} />}

      {turn.modelId && <ModelTag modelId={turn.modelId} live={streaming} />}

      {streaming ? (
        <WorkingDisclosure
          activity={turn.activity}
          sources={turn.sources}
          hasAnswer={Boolean(turn.body)}
          paused={paused}
        />
      ) : (
        summary && <p className="mono px-1 text-fg-tertiary">{summary}</p>
      )}

      {/* Research can resolve before the model starts writing. Do not make its evidence wait
          behind the final prose. */}
      {turn.body && (
        <div className="space-y-3">
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
          {!streaming && turn.sources.length > 0 && (
            <Sources sources={turn.sources} title="Sources" />
          )}
        </div>
      )}

      {turn.status === "error" && turn.error && (
        <div role="alert" className="rounded-md border border-subtle bg-raised p-3">
          <p className="text-sm font-[var(--weight-emph)] text-danger">{turn.error.message}</p>
          <p className="mt-0.5 text-xs text-fg-secondary">{turn.error.detail}</p>
        </div>
      )}

      {turn.status === "cancelled" && <p className="mono px-1 text-fg-tertiary">stopped</p>}
    </div>
  );
});

/**
 * Separately memoised so that an activity or source event — which arrives while the body is
 * unchanged — does not re-parse the markdown.
 */
export const AnswerBody = memo(function AnswerBody({
  body,
  objects,
  onObjectClick,
}: {
  body: string;
  objects: Record<ObjectId, ScapeObject>;
  onObjectClick?: (id: ObjectId) => void;
}) {
  const blocks = useMemo(() => splitMarkdownBlocks(body), [body]);
  const components = useMemo<Components>(
    () => ({
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
    }),
    [objects, onObjectClick],
  );
  return (
    <article className="rounded-lg border border-subtle bg-raised p-5 text-fg shadow-sm">
      {blocks.map((block, index) => (
        <MarkdownBlock key={index} content={block} components={components} />
      ))}
    </article>
  );
});

const MarkdownBlock = memo(function MarkdownBlock({
  content,
  components,
}: {
  content: string;
  components: Components;
}) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
});

export function splitMarkdownBlocks(markdown: string): string[] {
  // A blank line is a stable Markdown block boundary. Everything before it becomes immutable
  // from React's perspective; only the final fragment receives new content and is reparsed.
  // The surrounding article keeps all fragments in one conversational surface.
  const blocks: string[] = [];
  let start = 0;
  let inFence = false;
  const lines = markdown.split("\n");
  let offset = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === "") {
      const block = markdown.slice(start, offset).trim();
      if (block) blocks.push(block);
      start = offset + line.length + 1;
    }
    offset += line.length + 1;
  }

  const active = markdown.slice(start).trim();
  if (active) blocks.push(active);
  return blocks;
}
