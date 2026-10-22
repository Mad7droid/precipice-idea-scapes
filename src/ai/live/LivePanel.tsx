import { useEffect, useId, useRef, useState } from "react";
import { describeModel } from "@/ai/models";
import { DotMatrix } from "@/ai/DotMatrix";
import type { LiveEntry } from "./useLiveVoice";

/**
 * Live voice adds no height. While live, this single line sits where the draft would: the
 * words still being heard, or the latest phrase and what it became. Earlier phrases live in a
 * popover that overlays the canvas instead of pushing it. The canvas is the point; voice
 * should be ambient.
 */
export function LiveLine({
  partial,
  entries,
  jevOn,
}: {
  partial: string;
  entries: LiveEntry[];
  jevOn: boolean;
}) {
  const latest = entries.at(-1);
  return (
    <div
      className="flex min-h-[2.75rem] items-center gap-2 px-4 pt-3 text-sm"
      role="status"
      aria-live="polite"
    >
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full bg-danger motion-safe:animate-pulse"
      />
      <span className="min-w-0 flex-1 truncate">
        {partial ? (
          <span className="italic text-fg-secondary">{partial}</span>
        ) : latest ? (
          <span className="text-fg">“{latest.text}”</span>
        ) : (
          <span className="text-fg-tertiary">
            Listening — each pause runs what you say.{" "}
            {jevOn ? "Jev routes." : "Routed on this device."}
          </span>
        )}
      </span>
      {latest && !partial && (
        <span className="mono max-w-[55%] shrink-0 truncate normal-case tracking-normal text-fg-tertiary">
          <EntryMeta entry={latest} compact />
        </span>
      )}
    </div>
  );
}

/** A quiet "3 runs" control that opens earlier phrases as an overlay, never inline. */
export function LiveHistory({ entries, onClear }: { entries: LiveEntry[]; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    const onPointer = (event: PointerEvent) =>
      !root.current?.contains(event.target as Node) && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);
  if (entries.length === 0) return null;
  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className="mono normal-case tracking-normal text-fg-tertiary transition-colors duration-instant ease-out hover:text-fg"
        title="What live voice ran, with timings"
      >
        {entries.length} {entries.length === 1 ? "run" : "runs"}
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label="Live voice runs"
          className="absolute bottom-full right-0 z-10 mb-2 w-[min(34rem,80vw)] rounded-md border border-subtle bg-raised p-2 text-xs shadow-md origin-bottom-right animate-node-enter motion-reduce:animate-none"
        >
          <ol className="max-h-56 space-y-1.5 overflow-auto">
            {entries.map((entry) => (
              <li key={entry.id} className="min-w-0">
                <p className="truncate text-fg">“{entry.text}”</p>
                <p className="mono truncate normal-case tracking-normal text-fg-tertiary">
                  <EntryMeta entry={entry} />
                </p>
              </li>
            ))}
          </ol>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
              className="text-fg-secondary hover:text-fg"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EntryMeta({ entry, compact = false }: { entry: LiveEntry; compact?: boolean }) {
  if (entry.stage === "routing") return <DotMatrix label="routing" />;
  if (entry.error) return <span data-stage="failed">{`Jev failed · ${entry.error}`}</span>;
  const parts: string[] = [];
  if (entry.action) parts.push(entry.action);
  parts.push(
    entry.decider === "jev"
      ? `Jev ${entry.routeMs} ms`
      : entry.decider === "fallback"
        ? `on-device ${entry.routeMs} ms${compact ? "" : " (Jev didn’t answer)"}`
        : `on-device ${entry.routeMs} ms`,
  );
  if (entry.modelId && !compact) {
    const { provider, model } = describeModel(entry.modelId);
    parts.push(`${provider} ${model}`);
  }
  if (entry.stage === "done" && entry.runMs !== undefined && entry.runMs > 0)
    parts.push(`${(entry.runMs / 1000).toFixed(1)} s`);
  if (entry.stage === "queued") parts.push("next");
  if (entry.stage === "skipped") parts.push("not run");
  if (entry.stage === "failed") parts.push("failed");
  return (
    <span data-stage={entry.stage}>
      {parts.join(" · ")}
      {entry.stage === "running" && (
        <>
          {" · "}
          <DotMatrix label="running" />
        </>
      )}
    </span>
  );
}
