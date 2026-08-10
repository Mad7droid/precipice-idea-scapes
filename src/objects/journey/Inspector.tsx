import { useState } from "react";
import type { ActionPayload } from "@/core/actions";
import type { ScapeObject } from "@/core/types";
import {
  Field,
  IconButton,
  RichTextEditor,
  SectionHeader,
  TextInput,
  useDebouncedText,
} from "../ui";
import type { JourneyData, JourneyStep } from "./schema";

let stepCounter = 0;
const newStepId = () => `step_${Date.now().toString(36)}${(stepCounter++).toString(36)}`;

export function JourneyInspector({
  object,
  dispatch,
}: {
  object: ScapeObject;
  dispatch: (payload: ActionPayload) => void;
}) {
  const steps = ((object.data as Partial<JourneyData>).steps ?? []).filter(Boolean);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const commitSteps = (next: JourneyStep[]) =>
    dispatch({ type: "MergeObjectData", id: object.id, data: { steps: next } });

  const [title, setTitle, flushTitle] = useDebouncedText(object.title, (next) =>
    dispatch({ type: "UpdateObject", id: object.id, patch: { title: next } }),
  );

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= steps.length) return;
    const next = [...steps];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commitSteps(next);
  };

  return (
    <div>
      <SectionHeader>journey</SectionHeader>
      <Field label="Title">
        <TextInput
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={flushTitle}
          placeholder="Untitled"
        />
      </Field>

      <SectionHeader>steps</SectionHeader>
      {steps.length === 0 ? (
        <p className="text-xs text-fg-tertiary">No steps yet. Add the first one below.</p>
      ) : (
        <ol className="space-y-2">
          {steps.map((step, i) => (
            <li
              key={step.id}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragEnd={() => setDragIndex(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) move(dragIndex, i);
                setDragIndex(null);
              }}
              className={
                "rounded-md border border-subtle bg-surface p-2 transition-opacity " +
                "duration-fast ease-out " +
                (dragIndex === i ? "opacity-40" : "opacity-100")
              }
            >
              <StepRow
                index={i}
                step={step}
                canMoveUp={i > 0}
                canMoveDown={i < steps.length - 1}
                onMoveUp={() => move(i, i - 1)}
                onMoveDown={() => move(i, i + 1)}
                onRemove={() => commitSteps(steps.filter((_, j) => j !== i))}
                onChange={(next) => commitSteps(steps.map((s, j) => (j === i ? next : s)))}
              />
            </li>
          ))}
        </ol>
      )}

      <button
        type="button"
        onClick={() => commitSteps([...steps, { id: newStepId(), label: "" }])}
        className="mt-3 w-full rounded-md border border-subtle px-3 py-1.5 text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
      >
        Add step
      </button>
    </div>
  );
}

function StepRow({
  index,
  step,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  index: number;
  step: JourneyStep;
  onChange: (next: JourneyStep) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const [label, setLabel, flushLabel] = useDebouncedText(step.label, (next) =>
    onChange({ ...step, label: next }),
  );
  const [detail, setDetail, flushDetail] = useDebouncedText(step.detail ?? "", (next) =>
    onChange(next ? { ...step, detail: next } : { id: step.id, label: step.label }),
  );

  return (
    <div className="flex items-start gap-2">
      <span
        className="mono w-3 shrink-0 cursor-grab pt-2 text-right normal-case tracking-normal"
        aria-hidden
      >
        {index + 1}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <TextInput
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={flushLabel}
          placeholder="What happens here?"
          aria-label={`Step ${index + 1} label`}
        />
        <RichTextEditor
          value={detail}
          placeholder="Detail (optional)"
          onChange={setDetail}
          onBlur={flushDetail}
          compact
        />
      </div>
      <div className="flex shrink-0 flex-col">
        {/* Drag reorders; these keep reordering reachable from the keyboard. */}
        <IconButton label={`Move step ${index + 1} up`} onClick={canMoveUp ? onMoveUp : () => {}}>
          <Chevron up disabled={!canMoveUp} />
        </IconButton>
        <IconButton
          label={`Move step ${index + 1} down`}
          onClick={canMoveDown ? onMoveDown : () => {}}
        >
          <Chevron disabled={!canMoveDown} />
        </IconButton>
        <IconButton label={`Delete step ${index + 1}`} onClick={onRemove} danger>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path
              d="M2.5 2.5l7 7M9.5 2.5l-7 7"
              stroke="currentColor"
              strokeWidth="1.4"
              fill="none"
            />
          </svg>
        </IconButton>
      </div>
    </div>
  );
}

function Chevron({ up, disabled }: { up?: boolean; disabled?: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden
      style={{ opacity: disabled ? 0.3 : 1, transform: up ? undefined : "rotate(180deg)" }}
    >
      <path d="M3 7.5L6 4.5l3 3" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </svg>
  );
}
