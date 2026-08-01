import { useState } from "react";
import type { ActionPayload } from "@/core/actions";
import type { ScapeObject } from "@/core/types";
import { Field, IconButton, SectionHeader, TextInput, useDebouncedText } from "../ui";
import {
  PRIMITIVE_KINDS,
  type Primitive,
  type PrimitiveKind,
  type WireframeData,
} from "./schema";

let counter = 0;
const newPrimitiveId = () => `el_${Date.now().toString(36)}${(counter++).toString(36)}`;

export function WireframeInspector({
  object,
  dispatch,
}: {
  object: ScapeObject;
  dispatch: (payload: ActionPayload) => void;
}) {
  const primitives = ((object.data as Partial<WireframeData>).primitives ?? []).filter(Boolean);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const commit = (next: Primitive[]) =>
    dispatch({ type: "UpdateObject", id: object.id, patch: { data: { primitives: next } } });

  const [title, setTitle] = useDebouncedText(object.title, (next) =>
    dispatch({ type: "UpdateObject", id: object.id, patch: { title: next } }),
  );

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= primitives.length) return;
    const next = [...primitives];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit(next);
  };

  return (
    <div>
      <SectionHeader>wireframe</SectionHeader>
      <Field label="Title">
        <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled" />
      </Field>

      <SectionHeader>elements</SectionHeader>
      {primitives.length === 0 ? (
        <p className="text-xs text-fg-tertiary">No elements yet. Add the first one below.</p>
      ) : (
        <ul className="space-y-2">
          {primitives.map((p, i) => (
            <li
              key={p.id}
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
              <PrimitiveRow
                index={i}
                primitive={p}
                canMoveUp={i > 0}
                canMoveDown={i < primitives.length - 1}
                onMoveUp={() => move(i, i - 1)}
                onMoveDown={() => move(i, i + 1)}
                onRemove={() => commit(primitives.filter((_, j) => j !== i))}
                onChange={(next) => commit(primitives.map((q, j) => (j === i ? next : q)))}
              />
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => commit([...primitives, { id: newPrimitiveId(), kind: "box", span: 12 }])}
        className="mt-3 w-full rounded-md border border-subtle px-3 py-1.5 text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
      >
        Add element
      </button>
    </div>
  );
}

function PrimitiveRow({
  index,
  primitive,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  index: number;
  primitive: Primitive;
  onChange: (next: Primitive) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const [label, setLabel] = useDebouncedText(primitive.label ?? "", (next) =>
    onChange(
      next
        ? { ...primitive, label: next }
        : { id: primitive.id, kind: primitive.kind, span: primitive.span },
    ),
  );
  const [spanError, setSpanError] = useState<string | undefined>(undefined);

  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex gap-1.5">
          <select
            aria-label={`Element ${index + 1} kind`}
            value={primitive.kind}
            onChange={(e) => onChange({ ...primitive, kind: e.target.value as PrimitiveKind })}
            className="rounded-md border border-subtle bg-inset px-2 py-1.5 text-fg focus:border-focus focus-self"
          >
            {PRIMITIVE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-fg-secondary">
            <span className="mono">span</span>
            <input
              type="number"
              min={1}
              max={12}
              value={primitive.span}
              aria-label={`Element ${index + 1} span`}
              onChange={(e) => {
                const raw = Number(e.target.value) || 1;
                const clamped = Math.min(12, Math.max(1, raw));
                setSpanError(raw !== clamped ? "Span must be between 1 and 12 — clamped." : undefined);
                onChange({ ...primitive, span: clamped });
              }}
              className="w-14 rounded-md border border-subtle bg-inset px-2 py-1.5 text-fg focus:border-focus focus-self"
            />
          </label>
        </div>
        {spanError && <p className="text-xs text-danger">{spanError}</p>}
        <TextInput
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          aria-label={`Element ${index + 1} label`}
        />
      </div>
      <div className="flex shrink-0 flex-col">
        <IconButton label={`Move element ${index + 1} up`} onClick={canMoveUp ? onMoveUp : () => {}}>
          <Chevron up disabled={!canMoveUp} />
        </IconButton>
        <IconButton
          label={`Move element ${index + 1} down`}
          onClick={canMoveDown ? onMoveDown : () => {}}
        >
          <Chevron disabled={!canMoveDown} />
        </IconButton>
        <IconButton label={`Delete element ${index + 1}`} onClick={onRemove} danger>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.4" fill="none" />
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
