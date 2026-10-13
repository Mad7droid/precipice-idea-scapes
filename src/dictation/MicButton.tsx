import { useEffect, useRef, useState } from "react";
import { Button } from "@/design/Button";
import { DotMatrix } from "@/ai/DotMatrix";
import type { Dictation } from "./useDictation";

/**
 * The composer's dictation control. Click to start, click to stop, Esc to discard. Text lands
 * in the draft phrase by phrase and is never sent on its own — the person still presses ⌘↵.
 *
 * Absent rather than disabled where dictation cannot run: a control that cannot do anything
 * is a promise the app does not keep.
 */
export function MicButton({
  dictation,
  size = "sm",
}: {
  dictation: Dictation;
  size?: "sm" | "md";
}) {
  const { status, active, level, startedAt } = dictation;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const wasActive = useRef(false);

  // A session that ends in an error says why, without the person having to hunt for it.
  useEffect(() => {
    if (wasActive.current && status?.kind === "error") setOpen(true);
    wasActive.current = active;
  }, [active, status]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!status || status.kind === "unavailable") return null;

  if (active) {
    return (
      <button
        type="button"
        onClick={dictation.toggle}
        disabled={status.kind === "finishing"}
        aria-label={status.kind === "finishing" ? "Finishing dictation" : "Stop dictation"}
        title="Click to stop · Esc to discard"
        className="mono flex h-7 items-center gap-2 rounded-full border border-focus bg-selected px-2.5 normal-case tracking-normal text-fg transition-colors duration-instant ease-out hover:bg-hover"
      >
        {status.kind === "finishing" ? (
          <DotMatrix label="writing" />
        ) : (
          <>
            <Meter level={level} />
            <Elapsed since={startedAt} />
            <span aria-hidden className="block h-2 w-2 rounded-[2px] bg-current" />
          </>
        )}
      </button>
    );
  }

  const installing = status.kind === "installing";
  const percent = installing ? Math.floor((status.received / Math.max(status.total, 1)) * 100) : 0;
  const onClick = () => {
    if (status.kind === "ready") dictation.toggle();
    else if (status.kind === "error") {
      setOpen(false);
      dictation.toggle();
    } else setOpen((o) => !o);
  };

  return (
    <div className="relative" ref={root} onPointerEnter={dictation.prepare}>
      <Button
        variant="ghost"
        size={size}
        shape="icon"
        onClick={onClick}
        onFocus={dictation.prepare}
        aria-label={installing ? `Downloading speech model, ${percent}%` : "Dictate"}
        title={
          status.kind === "error"
            ? status.message
            : installing
              ? "Downloading the speech model"
              : "Dictate — speech becomes text on this Mac"
        }
        className="relative"
      >
        {installing ? (
          <span className="mono text-xs normal-case tracking-normal">{percent}%</span>
        ) : (
          <MicGlyph />
        )}
        {status.kind === "error" && (
          <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-danger" />
        )}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label="Dictation"
          className="absolute bottom-full right-0 z-10 mb-1.5 w-64 rounded-md border border-subtle bg-raised p-3 text-xs text-fg-secondary shadow-md"
        >
          {status.kind === "needs-model" && (
            <>
              <p className="text-fg">Dictate on this Mac</p>
              <p className="mt-1">
                Speech becomes text here, on your Mac. Audio is never saved or sent. It needs a
                one-time {megabytes(status.bytes)} speech model from Precipice.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  Not now
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    dictation.install();
                    setOpen(false);
                  }}
                >
                  Download
                </Button>
              </div>
            </>
          )}
          {installing && (
            <>
              <p className="text-fg">Downloading the speech model</p>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-inset">
                <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
              </div>
              <p className="mono mt-1.5 normal-case tracking-normal">
                {megabytes(status.received)} of {megabytes(status.total)}
              </p>
              <div className="mt-3 flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    dictation.cancelInstall();
                    setOpen(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </>
          )}
          {status.kind === "error" && (
            <>
              <p className="text-fg">Dictation stopped</p>
              <p className="mt-1">{status.message}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function megabytes(bytes: number) {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

/** Four bars that follow the voice. Speech RMS sits around 0.02–0.2, hence the square root. */
function Meter({ level }: { level: number }) {
  const v = Math.min(1, Math.sqrt(level) * 2.2);
  return (
    <span aria-hidden className="flex h-3.5 items-center gap-[2px]">
      {[0.55, 0.9, 1, 0.7].map((weight, i) => (
        <span
          key={i}
          className="block w-[2px] rounded-full bg-accent transition-[height] duration-instant ease-out"
          style={{ height: `${Math.max(2, Math.round(14 * v * weight))}px` }}
        />
      ))}
    </span>
  );
}

function Elapsed({ since }: { since: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const seconds = since ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
  return (
    <span className="tabular-nums" role="timer">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </span>
  );
}

function MicGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <rect
        x="4.75"
        y="1.25"
        width="4.5"
        height="7.5"
        rx="2.25"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
      />
      <path
        d="M2.75 6.75a4.25 4.25 0 0 0 8.5 0M7 11v1.75"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
