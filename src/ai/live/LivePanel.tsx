import { describeModel } from "@/ai/models";
import { DotMatrix } from "@/ai/DotMatrix";
import { Button } from "@/design/Button";
import type { LiveEntry } from "./useLiveVoice";

/**
 * What live voice is doing, phrase by phrase: the words still being heard, then for each
 * finished phrase what it became, who decided that, which model ran it and how long each step
 * took. Timings are the point — this is how a person sees how fast voice can go.
 */
export function LivePanel({
  listening,
  partial,
  entries,
  jevOn,
  onStop,
  onClear,
}: {
  listening: boolean;
  partial: string;
  entries: LiveEntry[];
  jevOn: boolean;
  onStop: () => void;
  onClear: () => void;
}) {
  return (
    <section
      aria-label="Live voice"
      className="border-b border-subtle px-3 pb-2 pt-2.5 text-xs text-fg-secondary"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={
            "h-2 w-2 rounded-full " +
            (listening ? "bg-danger motion-safe:animate-pulse" : "bg-[var(--border-default)]")
          }
        />
        <span className="font-medium text-fg">{listening ? "Live" : "Live stopped"}</span>
        <span
          className="mono normal-case tracking-normal"
          title={
            jevOn
              ? "Each phrase is routed by Jev, with on-device routing as the fallback."
              : "Each phrase is routed on this device. Turn on Jev in Settings → AI."
          }
        >
          {jevOn ? "routing: Jev" : "routing: on-device"}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {listening ? (
            <Button variant="secondary" size="sm" onClick={onStop}>
              Stop
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onClear}>
              Clear
            </Button>
          )}
        </span>
      </div>
      {listening && (
        <p className="mt-1.5 min-h-[1.25rem] italic text-fg-tertiary" aria-live="off">
          {partial || "Speak. Each pause runs what you said — no Send needed."}
        </p>
      )}
      {entries.length > 0 && (
        <ol className="mt-1.5 space-y-1" aria-live="polite">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-fg">“{entry.text}”</span>
              <span aria-hidden>→</span>
              <EntryStatus entry={entry} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function EntryStatus({ entry }: { entry: LiveEntry }) {
  if (entry.stage === "routing") return <DotMatrix label="routing" />;
  const parts: string[] = [];
  if (entry.action) parts.push(entry.action);
  parts.push(
    entry.decider === "jev"
      ? `Jev ${entry.routeMs} ms`
      : entry.decider === "fallback"
        ? `on-device ${entry.routeMs} ms (Jev didn’t answer)`
        : `on-device ${entry.routeMs} ms`,
  );
  if (entry.modelId) {
    const { provider, model } = describeModel(entry.modelId);
    parts.push(`${provider} ${model}`);
  }
  if (entry.stage === "done" && entry.runMs !== undefined && entry.runMs > 0)
    parts.push(`done in ${(entry.runMs / 1000).toFixed(1)} s`);
  return (
    <span className="mono normal-case tracking-normal" data-stage={entry.stage}>
      {parts.join(" · ")}
      {entry.stage === "queued" && " · waiting"}
      {entry.stage === "running" && (
        <>
          {" · "}
          <DotMatrix label="running" />
        </>
      )}
      {entry.stage === "skipped" && " · not run"}
    </span>
  );
}
