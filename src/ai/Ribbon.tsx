import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DotMatrix } from "./DotMatrix";
import type { GenerationState } from "./useGeneration";

/**
 * What the wait is spent on, in the order it happens. The model gives no progress signal
 * before its first tool call, so these are honest about the phase, not a fake percentage.
 */
const THINKING_PHRASES = ["Reading the scape…", "Planning the shape…", "Writing objects…"];
const PHRASE_MS = 2600;

function useThinkingPhrase(active: boolean) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) {
      setIndex(0);
      return;
    }
    const id = setInterval(
      () => setIndex((i) => Math.min(i + 1, THINKING_PHRASES.length - 1)),
      PHRASE_MS,
    );
    return () => clearInterval(id);
  }, [active]);
  return THINKING_PHRASES[index] ?? THINKING_PHRASES[0]!;
}

/**
 * The signature element.
 *
 * When AI generates, Precipice does not show a spinner and then a finished canvas. Each
 * action appears here as it lands — mono, one line — while the matching node scales in on
 * the canvas. When it finishes this collapses to a single line: how many actions, which
 * model, and an undo that reverses the whole transaction.
 *
 * It stays informative under `prefers-reduced-motion`: the animation goes, the information
 * does not.
 */
export function Ribbon({
  state,
  onCancel,
  onUndo,
  onDismiss,
}: {
  state: GenerationState;
  onCancel: () => void;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const [showSkipped, setShowSkipped] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const phrase = useThinkingPhrase(state.status === "streaming" && state.lines.length === 0);

  // Keep the newest line in view as the ribbon fills.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [state.lines.length]);

  useEffect(() => {
    if (state.status !== "done") {
      setShowSkipped(false);
      setShowSteps(false);
    }
  }, [state.status]);

  if (state.status === "idle") return null;

  if (state.status === "error") {
    return (
      <Strip>
        <div className="flex items-center gap-3 px-3 py-2">
          <span className="mono text-danger">failed</span>
          <span className="min-w-0 flex-1 truncate text-fg">{state.error?.message}</span>
          <span className="truncate text-xs text-fg-secondary">{state.error?.detail}</span>
          <RibbonButton onClick={onDismiss}>Dismiss</RibbonButton>
        </div>
      </Strip>
    );
  }

  if (state.status === "streaming") {
    return (
      <Strip>
        <ol ref={listRef} className="max-h-[132px] overflow-y-auto px-3 py-2">
          {state.lines.map((line) => (
            <li key={line.key} className="mono animate-ribbon-line normal-case tracking-normal">
              {line.text}
            </li>
          ))}
          {state.lines.length === 0 && (
            <li className="py-0.5 text-fg-secondary">
              <DotMatrix label={phrase} />
            </li>
          )}
        </ol>
        <div className="flex items-center justify-between border-t border-subtle px-3 py-1.5">
          <span className="mono flex items-center gap-2">
            {state.lines.length > 0 && <DotMatrix />}
            {state.applied} {state.applied === 1 ? "action" : "actions"}
            {state.skipped.length > 0 && ` · ${state.skipped.length} skipped`}
          </span>
          <RibbonButton onClick={onCancel}>Stop</RibbonButton>
        </div>
      </Strip>
    );
  }

  // Collapsed: `18 actions · claude-sonnet-5 · undo`
  return (
    <Strip>
      {/* The steps stay available after the stream ends — "18 actions" is a claim, and this
          is the receipt for it. Collapsed by default; the canvas is the point. */}
      {showSteps && state.lines.length > 0 && (
        <ol className="max-h-[180px] overflow-y-auto border-b border-subtle px-3 py-2">
          {state.lines.map((line) => (
            <li key={line.key} className="mono normal-case tracking-normal">
              {line.text}
            </li>
          ))}
        </ol>
      )}
      <div className="relative flex items-center gap-2 px-3 py-2">
        {state.lines.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowSteps((open) => !open)}
            aria-expanded={showSteps}
            className="mono normal-case tracking-normal text-fg-secondary transition-colors duration-instant ease-out hover:text-fg"
            title={showSteps ? "Hide the steps" : "Show the steps taken"}
          >
            <span aria-hidden className="mr-1.5 inline-block">
              {showSteps ? "▾" : "▸"}
            </span>
            {state.applied === 1 ? state.lines[0]?.text : `${state.applied} changes applied`}
          </button>
        ) : (
          <span className="mono normal-case tracking-normal">
            {state.applied} {state.applied === 1 ? "action" : "actions"}
          </span>
        )}
        {state.skipped.length > 0 && (
          <>
            <Dot />
            <button
              type="button"
              onClick={() => setShowSkipped((open) => !open)}
              aria-expanded={showSkipped}
              className="mono normal-case tracking-normal text-fg-secondary underline decoration-dotted underline-offset-2 hover:text-fg"
            >
              {state.skipped.length} skipped
            </button>
          </>
        )}
        <Dot />
        <span className="mono normal-case tracking-normal">{state.model}</span>
        <Dot />
        <button
          type="button"
          onClick={onUndo}
          className="mono normal-case tracking-normal text-fg-accent hover:underline"
        >
          undo
        </button>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="ml-auto rounded-sm px-1 text-fg-tertiary transition-colors duration-instant ease-out hover:text-fg"
        >
          ✕
        </button>

        {showSkipped && <SkippedPopover state={state} />}
      </div>
    </Strip>
  );
}

/**
 * What failed validation and why — so "2 skipped" is never the end of the story.
 *
 * The raw payload used to be printed here, which is what made this overflow: a serialised
 * action is one long unbroken string, and no amount of truncation helps a box that is already
 * wider than the panel holding it. The tool and the reason are what a person can act on; the
 * payload is for a log. So this names the action, says why it was dropped, and stays inside
 * its container.
 */
function SkippedPopover({ state }: { state: GenerationState }) {
  return (
    <div className="absolute bottom-full left-0 right-0 z-popover mb-2 max-h-[220px] overflow-y-auto rounded-lg border border-subtle bg-raised p-3 shadow-lg">
      <h3 className="mono mb-2">skipped · {state.skipped.length}</h3>
      <ul className="space-y-2">
        {state.skipped.map((item, i) => (
          <li key={i} className="border-b border-subtle pb-2 last:border-0 last:pb-0">
            <div className="mono normal-case tracking-normal text-fg-secondary">
              {item.tool}
              {subjectOf(item.input) && (
                <span className="text-fg-tertiary"> · {subjectOf(item.input)}</span>
              )}
            </div>
            <p className="mt-0.5 break-words text-xs text-fg">{item.reason}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Whatever names the dropped action in one short phrase, if it carried anything that does. */
function subjectOf(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  for (const key of ["title", "id", "from", "type"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.length > 40 ? `${value.slice(0, 39)}…` : value;
    }
  }
  return null;
}

const Dot = () => (
  <span aria-hidden className="text-fg-tertiary">
    ·
  </span>
);

function Strip({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[720px] overflow-hidden rounded-xl border border-subtle bg-surface shadow-md">
      {children}
    </div>
  );
}

function RibbonButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-full border border-subtle px-2.5 py-0.5 text-xs text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
    >
      {children}
    </button>
  );
}
