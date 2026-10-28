import { useRef } from "react";
import { useScapeStore } from "@/core/store";
import type { ObjectId } from "@/core/types";

const DEFAULT_CLASS =
  "nodrag nopan w-full rounded-sm border border-focus bg-raised px-1 text-sm font-medium text-fg focus-self";

/**
 * The one inline editor every card uses for a single-line field on the canvas.
 *
 * Enter and blur commit; Escape cancels. Cancel has to be explicit: leaving edit mode unmounts
 * the input, and a blur that fires on the way out would otherwise commit the draft the person
 * just asked to throw away. An unchanged value never dispatches, so opening and closing the
 * editor leaves no undo step behind.
 */
export function InlineTextEdit({
  value,
  onCommit,
  onDone,
  className = DEFAULT_CLASS,
  ariaLabel,
}: {
  value: string;
  onCommit: (next: string) => void;
  onDone: () => void;
  className?: string;
  ariaLabel?: string;
}) {
  const cancelled = useRef(false);
  return (
    <input
      autoFocus
      defaultValue={value}
      aria-label={ariaLabel}
      onBlur={(e) => {
        const next = e.currentTarget.value;
        onDone();
        if (cancelled.current) return;
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(e) => {
        // Keys typed here belong to the field, never to the canvas shortcuts behind it.
        e.stopPropagation();
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      className={className}
    />
  );
}

/** `InlineTextEdit` wired to an object's title through the reducer. */
export function InlineTitle({
  id,
  title,
  readOnly,
  onDone,
  className,
}: {
  id: ObjectId;
  title: string;
  readOnly: boolean;
  onDone: () => void;
  className?: string;
}) {
  return (
    <InlineTextEdit
      value={title}
      ariaLabel="Title"
      onDone={onDone}
      onCommit={(next) => {
        if (readOnly) return;
        useScapeStore.getState().dispatchTx([{ type: "UpdateObject", id, patch: { title: next } }]);
      }}
      {...(className ? { className } : {})}
    />
  );
}
