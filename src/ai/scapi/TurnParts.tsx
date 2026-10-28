import { useEffect, useState } from "react";
import { DotMatrix } from "@/ai/DotMatrix";
import { describeModel } from "@/ai/models";
import type { ActivityEvent, Turn } from "./types";

/** The pieces of one Scapi turn around its answer: disclosures, actions, sources and status. */
/**
 * Thinking is useful evidence while Scapi is waiting, then yields to the answer as soon as it
 * exists. The grid-row transition avoids measuring a stream that is still growing.
 */
export function ReasoningDisclosure({ turn }: { turn: Turn }) {
  const hasAnswer = turn.body.length > 0;
  const [expanded, setExpanded] = useState(!hasAnswer);

  useEffect(() => {
    if (hasAnswer) setExpanded(false);
  }, [hasAnswer]);

  return (
    <section className="rounded-md border border-subtle bg-surface">
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

export function TurnActions({
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

export function Sources({ sources, title }: { sources: Turn["sources"]; title: string }) {
  return (
    <section className="mt-3 border-t border-subtle pt-3">
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
export function WorkingDisclosure({
  activity,
  sources,
  hasAnswer,
  paused,
}: {
  activity: ActivityEvent[];
  sources: Turn["sources"];
  hasAnswer: boolean;
  paused: boolean;
}) {
  const [expanded, setExpanded] = useState(!hasAnswer);

  useEffect(() => {
    if (hasAnswer) setExpanded(false);
  }, [hasAnswer]);

  const done = activity.slice(0, -1);
  const current = activity[activity.length - 1];

  return (
    <section className="rounded-md border border-subtle bg-surface">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-fg-secondary transition-colors duration-instant ease-out hover:text-fg"
      >
        <span>{hasAnswer ? "Responding" : "Working…"}</span>
        <span className="min-w-0 truncate pl-3 text-right">
          {paused ? "preparing the next part" : current ? activityLabel(current) : "connecting"}
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
            <DotMatrix
              label={
                paused ? "preparing the next part" : current ? activityLabel(current) : "connecting"
              }
            />
            {sources.length > 0 && <Sources sources={sources} title="Research" />}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Which service is answering: the same words the Ribbon uses for an edit. */
export function ModelTag({ modelId, live }: { modelId: string; live: boolean }) {
  const { provider, model } = describeModel(modelId);
  return (
    <p
      className="mono px-1 normal-case tracking-normal text-fg-tertiary"
      data-provider={provider}
      title={`${live ? "Answering with" : "Answered by"} ${provider} (${model})`}
    >
      <span className="text-fg-secondary">{provider}</span> · {model}
    </p>
  );
}

/** One sentence for screen readers, without stacking "could not" on a message that says it. */
export function errorStatus(message: string | undefined): string {
  if (!message) return "Scapi could not respond.";
  return /^scapi\b/i.test(message) ? message : `Scapi could not respond: ${message}`;
}

/**
 * The error card for one turn. Exported so the canvas answer card can show a failure instead of
 * an empty box.
 */
export function AnswerError({ turn }: { turn: Turn }) {
  if (turn.status !== "error") return null;
  return (
    <div role="alert">
      <p className="text-sm font-[var(--weight-emph)] text-danger">
        {turn.error?.message ?? "Scapi could not respond"}
      </p>
      {turn.error?.detail && (
        <p className="mt-0.5 text-xs text-fg-secondary">{turn.error.detail}</p>
      )}
    </div>
  );
}

export function statusFor(turn: Turn | undefined, streaming: boolean): string {
  if (!turn) return "";
  if (turn.status === "error") return errorStatus(turn.error?.message);
  if (!streaming && turn.status === "done") return "Scapi response complete.";
  if (streaming && turn.body) return "Scapi is responding.";
  const current = turn.activity[turn.activity.length - 1];
  return current ? `Scapi is ${activityLabel(current)}.` : "Scapi is working.";
}

export function activityLabel(event: ActivityEvent): string {
  switch (event.kind) {
    case "reading-scape":
      return `reading the canvas: ${event.objects} object${event.objects === 1 ? "" : "s"}`;
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
export function summarise(activity: ActivityEvent[]): string | null {
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
