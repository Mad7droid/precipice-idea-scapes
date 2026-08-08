import { useState } from "react";
import type { ActionPayload } from "@/core/actions";
import type { ScapeObject } from "@/core/types";
import { Select } from "@/design/Select";
import { Field, IconButton, SectionHeader, TextInput, useDebouncedText } from "../ui";
import { PRESETS, scaleSpan } from "./presets";
import {
  columnsOf,
  COLUMN_CHOICES,
  DEFAULT_WIDTH,
  MAX_WIDTH,
  MIN_WIDTH,
  PRIMITIVE_KINDS,
  type Primitive,
  type PrimitiveKind,
  type WireframeData,
} from "./schema";

let counter = 0;
const newPrimitiveId = () => `el_${Date.now().toString(36)}${(counter++).toString(36)}`;

/** The kinds that earn a one-click button. The rest live in the kind dropdown on each row. */
const QUICK_ADD: PrimitiveKind[] = [
  "section",
  "heading",
  "text",
  "input",
  "button",
  "image",
  "list",
  "divider",
];

/** Kinds where vertical size is a real choice — a divider has no `lg`. */
const SIZEABLE: PrimitiveKind[] = ["box", "image", "list"];

export function WireframeInspector({
  object,
  dispatch,
}: {
  object: ScapeObject;
  dispatch: (payload: ActionPayload) => void;
}) {
  const data = object.data as Partial<WireframeData>;
  const primitives = (data.primitives ?? []).filter(Boolean);
  const columns = columnsOf(data);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);

  /**
   * `UpdateObject` replaces `data` wholesale rather than merging it, so every write has to
   * carry the keys it is not changing. Forgetting this is how a width silently disappears
   * the next time someone edits an element.
   */
  const patch = (next: Partial<WireframeData>) =>
    dispatch({
      type: "UpdateObject",
      id: object.id,
      patch: { data: { ...(object.data as Record<string, unknown>), ...next } },
    });

  const commit = (next: Primitive[]) => patch({ primitives: next });

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

  const add = (kind: PrimitiveKind) =>
    commit([...primitives, { id: newPrimitiveId(), kind, span: columns }]);

  const insertPreset = (index: number) => {
    const preset = PRESETS[index];
    if (!preset) return;
    commit([
      ...primitives,
      ...preset.elements.map((seed) => ({
        ...seed,
        id: newPrimitiveId(),
        span: scaleSpan(seed.span, columns),
      })),
    ]);
    setPresetsOpen(false);
  };

  return (
    <div>
      <SectionHeader>wireframe</SectionHeader>
      <Field label="Title">
        <TextInput
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled"
        />
      </Field>

      <div className="mt-3 flex gap-3">
        <div className="min-w-0 flex-1">
          <span className="mb-1 block text-xs text-fg-secondary">Width</span>
          <div className="flex items-center gap-1.5">
            <input
              type="range"
              min={MIN_WIDTH}
              max={MAX_WIDTH}
              step={10}
              value={data.width ?? DEFAULT_WIDTH}
              aria-label="Card width"
              onChange={(e) => patch({ width: Number(e.target.value) })}
              className="range-field min-w-0 flex-1"
            />
            <span className="mono shrink-0">{data.width ?? DEFAULT_WIDTH}</span>
          </div>
        </div>
        <div>
          <span className="mb-1 block text-xs text-fg-secondary">Grid</span>
          <Select
            label="Grid columns"
            value={String(columns)}
            onChange={(v) => patch({ columns: Number(v) as (typeof COLUMN_CHOICES)[number] })}
            options={COLUMN_CHOICES.map((c) => ({ value: String(c), label: `${c} col` }))}
            className="mono"
          />
        </div>
      </div>

      <SectionHeader>elements</SectionHeader>
      {primitives.length === 0 ? (
        <p className="text-xs text-fg-tertiary">
          Nothing on this screen yet. Start from a layout below, or add one element at a time.
        </p>
      ) : (
        <ul className="space-y-2">
          {primitives.map((p, i) => (
            <li
              key={p.id}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragEnd={() => {
                setDragIndex(null);
                setDropIndex(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDropIndex(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) move(dragIndex, i);
                setDragIndex(null);
                setDropIndex(null);
              }}
              className={
                "relative rounded-md border border-subtle bg-surface p-2 transition-all " +
                "duration-fast ease-out " +
                (dragIndex === i ? "opacity-40" : "opacity-100")
              }
            >
              {dropIndex === i && dragIndex !== null && dragIndex !== i && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -top-1 left-2 right-2 z-10 h-0.5 rounded-full bg-accent shadow-[0_0_0_2px_var(--accent-subtle)]"
                />
              )}
              <PrimitiveRow
                index={i}
                primitive={p}
                columns={columns}
                canMoveUp={i > 0}
                canMoveDown={i < primitives.length - 1}
                onMoveUp={() => move(i, i - 1)}
                onMoveDown={() => move(i, i + 1)}
                onDuplicate={() =>
                  commit([
                    ...primitives.slice(0, i + 1),
                    { ...p, id: newPrimitiveId() },
                    ...primitives.slice(i + 1),
                  ])
                }
                onRemove={() => commit(primitives.filter((_, j) => j !== i))}
                onChange={(next) => commit(primitives.map((q, j) => (j === i ? next : q)))}
              />
            </li>
          ))}
        </ul>
      )}

      <SectionHeader>add</SectionHeader>
      <div className="flex flex-wrap gap-1.5">
        {QUICK_ADD.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => add(kind)}
            className="mono rounded-md border border-subtle px-2 py-1 text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
          >
            + {kind}
          </button>
        ))}
        <Select
          label="Add another kind"
          value=""
          onChange={(v) => v && add(v as PrimitiveKind)}
          options={[
            { value: "", label: "More…" },
            ...PRIMITIVE_KINDS.filter((k) => !QUICK_ADD.includes(k)).map((k) => ({
              value: k,
              label: k,
            })),
          ]}
          className="mono"
        />
      </div>

      <div className="relative mt-3">
        <button
          type="button"
          onClick={() => setPresetsOpen((o) => !o)}
          aria-expanded={presetsOpen}
          className="w-full rounded-md border border-subtle px-3 py-1.5 text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
        >
          Insert a layout
        </button>
        {presetsOpen && (
          <div className="mt-1.5 overflow-hidden rounded-md border border-subtle bg-raised">
            {PRESETS.map((preset, i) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => insertPreset(i)}
                className="block w-full px-3 py-2 text-left transition-colors duration-instant ease-out hover:bg-hover"
              >
                <span className="block text-fg">{preset.name}</span>
                <span className="block text-xs text-fg-tertiary">{preset.hint}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PrimitiveRow({
  index,
  primitive,
  columns,
  onChange,
  onRemove,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  index: number;
  primitive: Primitive;
  columns: number;
  onChange: (next: Primitive) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const [label, setLabel] = useDebouncedText(primitive.label ?? "", (next) =>
    onChange(next ? { ...primitive, label: next } : omit(primitive, "label")),
  );
  const isSection = primitive.kind === "section";

  return (
    <details className="group rounded-sm" aria-label={`Element ${index + 1}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm px-1 py-1 text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover">
        <span
          aria-hidden
          title="Drag to reorder"
          className="cursor-grab select-none text-fg-tertiary active:cursor-grabbing"
        >
          ⠿
        </span>
        <span aria-hidden className="mono text-fg-tertiary group-open:rotate-90">
          ›
        </span>
        <span className="mono">{primitive.kind}</span>
        <span className="min-w-0 flex-1 truncate text-xs">
          {primitive.label || "Untitled element"}
        </span>
      </summary>
      <div className="mt-1 flex items-start gap-1.5">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Select
            label={`Element ${index + 1} kind`}
            value={primitive.kind}
            onChange={(v) => onChange({ ...primitive, kind: v as PrimitiveKind })}
            options={PRIMITIVE_KINDS.map((kind) => ({ value: kind, label: kind }))}
            className="mono"
          />
          <TextInput
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={isSection ? "Region name" : "Label (optional)"}
            aria-label={`Element ${index + 1} label`}
          />
          {/* A section is always the full row, so a width control on it would be a lie. */}
          {!isSection && (
            <>
              <SpanBar
                span={primitive.span}
                columns={columns}
                label={`Element ${index + 1} width`}
                onChange={(span) => onChange({ ...primitive, span })}
              />
              <div className="flex flex-wrap gap-1.5">
                <Segmented
                  label={`Element ${index + 1} alignment`}
                  value={primitive.align ?? "fill"}
                  options={[
                    { value: "fill", label: "fill" },
                    { value: "start", label: "left" },
                    { value: "center", label: "centre" },
                    { value: "end", label: "right" },
                  ]}
                  onChange={(v) =>
                    onChange(
                      v === "fill"
                        ? omit(primitive, "align")
                        : { ...primitive, align: v as "start" | "center" | "end" },
                    )
                  }
                />
                {SIZEABLE.includes(primitive.kind) && (
                  <Segmented
                    label={`Element ${index + 1} height`}
                    value={primitive.size ?? "auto"}
                    options={[
                      { value: "auto", label: "auto" },
                      { value: "sm", label: "S" },
                      { value: "md", label: "M" },
                      { value: "lg", label: "L" },
                    ]}
                    onChange={(v) =>
                      onChange(
                        v === "auto"
                          ? omit(primitive, "size")
                          : { ...primitive, size: v as "sm" | "md" | "lg" },
                      )
                    }
                  />
                )}
              </div>
            </>
          )}
        </div>
        <div className="-mr-1 flex shrink-0 flex-col">
          <IconButton
            label={`Move element ${index + 1} up`}
            onClick={canMoveUp ? onMoveUp : () => {}}
          >
            <Chevron up disabled={!canMoveUp} />
          </IconButton>
          <IconButton
            label={`Move element ${index + 1} down`}
            onClick={canMoveDown ? onMoveDown : () => {}}
          >
            <Chevron disabled={!canMoveDown} />
          </IconButton>
          <IconButton label={`Duplicate element ${index + 1}`} onClick={onDuplicate}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <rect
                x="1.2"
                y="1.2"
                width="6.6"
                height="6.6"
                rx="1.2"
                stroke="currentColor"
                strokeWidth="1.2"
                fill="none"
              />
              <rect
                x="4.2"
                y="4.2"
                width="6.6"
                height="6.6"
                rx="1.2"
                stroke="currentColor"
                strokeWidth="1.2"
                fill="none"
              />
            </svg>
          </IconButton>
          <IconButton label={`Delete element ${index + 1}`} onClick={onRemove} danger>
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
    </details>
  );
}

/**
 * Width as the grid itself, not as a number.
 *
 * The number field this replaces could express a span of 47 on a 12-column grid, which meant
 * it also had to explain that it had clamped you. A control that cannot say anything invalid
 * needs no error message, and reading "how wide is this" off a filled bar is instant in a way
 * that reading "7" never is.
 */
function SpanBar({
  span,
  columns,
  label,
  onChange,
}: {
  span: number;
  columns: number;
  label: string;
  onChange: (span: number) => void;
}) {
  const current = Math.min(columns, Math.max(1, span));
  return (
    <div
      role="group"
      aria-label={label}
      className="flex gap-[2px] overflow-hidden rounded-sm border border-subtle bg-inset p-[2px]"
    >
      {Array.from({ length: columns }, (_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`${i + 1} of ${columns} columns`}
          aria-pressed={current === i + 1}
          onClick={() => onChange(i + 1)}
          className={
            "h-4 flex-1 rounded-xs transition-colors duration-instant ease-out " +
            (i < current ? "bg-accent" : "bg-active hover:bg-hover")
          }
        />
      ))}
    </div>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex overflow-hidden rounded-sm border border-subtle"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={
            "mono px-1.5 py-1 transition-colors duration-instant ease-out " +
            (value === option.value
              ? "bg-active text-fg"
              : "text-fg-tertiary hover:bg-hover hover:text-fg-secondary")
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Drop an optional field rather than storing an empty one — absent is the schema's default. */
function omit(primitive: Primitive, key: "label" | "align" | "size"): Primitive {
  const next = { ...primitive };
  delete next[key];
  return next;
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
