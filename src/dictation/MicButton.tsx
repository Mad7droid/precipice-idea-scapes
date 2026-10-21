import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/design/Button";
import { DotMatrix } from "@/ai/DotMatrix";
import type { LevelSignal } from "./level";
import type { Dictation } from "./useDictation";

/**
 * The composer's dictation control. Click to start, click to finish, Esc to cancel pending audio. Text lands
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
  const dialogId = useId();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const closeDialog = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  // A session that ends in an error says why, without the person having to hunt for it.
  useEffect(() => {
    if (wasActive.current && status?.kind === "error") setOpen(true);
    if (!wasActive.current && active) previousFocus.current = document.activeElement as HTMLElement;
    if (wasActive.current && !active && document.activeElement === document.body)
      previousFocus.current?.focus();
    wasActive.current = active;
  }, [active, status]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    root.current?.querySelector<HTMLElement>('[role="dialog"] button')?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeDialog();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  if (!status || status.kind === "unavailable") return null;

  if (active) {
    return (
      <div className="flex items-center gap-1" role="group" aria-label="Dictation controls">
        <button
          type="button"
          onClick={dictation.toggle}
          disabled={status.kind === "starting" || status.kind === "finishing"}
          aria-label={
            status.kind === "starting"
              ? "Starting dictation"
              : status.kind === "finishing"
                ? "Finishing dictation"
                : "Stop dictation"
          }
          aria-keyshortcuts="Meta+Shift+Space Control+Shift+Space"
          title="Stop and keep text · ⌘/Ctrl+Shift+Space"
          className="mono flex h-8 items-center gap-2 rounded-full border border-focus bg-selected px-2.5 normal-case tracking-normal text-fg transition-colors duration-instant ease-out hover:bg-hover active:bg-active"
        >
          {status.kind === "starting" || status.kind === "finishing" ? (
            <span role="status">
              <DotMatrix label={status.kind === "starting" ? "Starting…" : "Finishing…"} />
            </span>
          ) : (
            <>
              <Meter level={level} />
              <span role="status">Listening</span>
              <Elapsed since={startedAt} />
              <span aria-hidden className="block h-2 w-2 rounded-xs bg-current" />
            </>
          )}
        </button>
        <Button
          variant="ghost"
          size={size}
          shape="icon"
          onClick={dictation.cancel}
          aria-label="Cancel dictation"
          title="Cancel pending audio · Esc. Text already inserted stays."
        >
          <span aria-hidden>×</span>
        </Button>
      </div>
    );
  }

  const installing = status.kind === "installing";
  // Browsers download their own language packs and report no size or progress.
  const progress = status.kind === "installing" && status.total > 0 ? status : null;
  const measured = !!progress;
  const percent = progress
    ? Math.min(100, Math.max(0, Math.floor((progress.received / progress.total) * 100)))
    : 0;
  const onClick = () => {
    if (status.kind === "ready") dictation.toggle();
    else if (status.kind === "error") {
      setOpen(true);
    } else setOpen((o) => !o);
  };

  return (
    <div
      className="relative"
      ref={root}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") dictation.prepare();
      }}
    >
      <Button
        variant="ghost"
        size={size}
        shape="icon"
        onClick={(event) => {
          trigger.current = event.currentTarget;
          onClick();
        }}
        disabled={
          status.kind === "starting" || status.kind === "listening" || status.kind === "finishing"
        }
        aria-haspopup={
          status.kind === "needs-model" || installing || status.kind === "error"
            ? "dialog"
            : undefined
        }
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-keyshortcuts="Meta+Shift+Space Control+Shift+Space"
        onFocus={dictation.prepare}
        aria-label={
          installing
            ? measured
              ? `Downloading speech model, ${percent}%`
              : "Downloading speech model"
            : "Dictate"
        }
        title={
          status.kind === "error"
            ? status.message
            : installing
              ? "Downloading the speech model"
              : "Dictate on this device · ⌘/Ctrl+Shift+Space"
        }
        className="relative"
      >
        {measured ? (
          <span className="mono text-xs normal-case tracking-normal">{percent}%</span>
        ) : installing ? (
          <DotMatrix />
        ) : (
          <MicGlyph />
        )}
        {status.kind === "error" && (
          <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-danger" />
        )}
      </Button>

      {open && (
        <div
          id={dialogId}
          role="dialog"
          aria-label="Dictation"
          className="absolute bottom-full right-0 z-10 mb-1.5 w-64 rounded-md border border-subtle bg-raised p-3 text-xs text-fg-secondary shadow-md origin-bottom-right animate-node-enter motion-reduce:animate-none"
        >
          {status.kind === "needs-model" && (
            <>
              {/* The Mac app ships its own sized model; a browser downloads an unsized pack. */}
              {status.bytes > 0 ? (
                <>
                  <p className="text-fg">Dictate on this Mac</p>
                  <p className="mt-1">
                    Speech becomes text here, on your Mac. Audio is never saved or sent. It needs a
                    one-time {megabytes(status.bytes)} speech model from Precipice.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-fg">Dictate in this browser</p>
                  <p className="mt-1">
                    Your browser turns speech into text on this device. Audio is never saved or
                    sent. It needs a one-time language pack, downloaded by your browser.
                  </p>
                </>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={closeDialog}>
                  Not now
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    dictation.install();
                    closeDialog();
                  }}
                >
                  Download
                </Button>
              </div>
            </>
          )}
          {installing && !measured && (
            <p className="text-fg" role="status">
              Your browser is downloading its speech model. The mic is ready when it finishes.
            </p>
          )}
          {measured && (
            <>
              <p className="text-fg">Downloading the speech model</p>
              <div
                className="mt-2 h-1 overflow-hidden rounded-full bg-inset"
                role="progressbar"
                aria-label="Speech model download"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <div
                  className="h-full origin-left bg-accent"
                  style={{ transform: `scaleX(${percent / 100})` }}
                />
              </div>
              <p className="mono mt-1.5 normal-case tracking-normal">
                {megabytes(progress!.received)} of {megabytes(progress!.total)}
              </p>
              <div className="mt-3 flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    dictation.cancelInstall();
                    closeDialog();
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
              <p className="mt-1" role="alert">
                {status.message}
              </p>
              <p className="mt-1">Your draft is still here.</p>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={closeDialog}>
                  Close
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    closeDialog();
                    dictation.toggle();
                  }}
                >
                  Try again
                </Button>
              </div>
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
function Meter({ level }: { level: LevelSignal }) {
  const rms = useSyncExternalStore(level.subscribe, level.getSnapshot, level.getSnapshot);
  const v = Math.min(1, Math.sqrt(rms) * 2.2);
  return (
    <span aria-hidden className="flex h-3.5 items-center gap-[2px]">
      {[0.55, 0.9, 1, 0.7].map((weight, i) => (
        <span
          key={i}
          className="block h-3.5 w-[2px] rounded-full bg-accent transition-transform duration-instant ease-out motion-reduce:!transform-none"
          style={{ transform: `scaleY(${Math.max(2 / 14, v * weight)})` }}
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
