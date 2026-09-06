import { useState } from "react";
import type { ActionPayload } from "@/core/actions";
import {
  MARK_LABELS,
  MARK_NAMES,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  markColor,
  normalizeTags,
} from "@/core/marks";
import type { ScapeObject } from "@/core/types";

/**
 * Colour and tags for one block.
 *
 * Host chrome, not plugin content — exactly like the resize grip. A marker is a property of
 * the card rather than of a note or a wireframe, so it is edited in one place and every type
 * gets it for free, rather than being re-implemented once per plugin.
 *
 * It sits above the plugin's own inspector because it answers a question you ask about a
 * block from across the canvas ("which group is this in"), not one you ask from inside it.
 */
export function BlockMarkers({
  object,
  dispatch,
  suggestions,
}: {
  object: ScapeObject;
  dispatch: (payload: ActionPayload) => void;
  /** Tags already used elsewhere in this scape, so a vocabulary forms instead of scattering. */
  suggestions: string[];
}) {
  const tags = object.tags ?? [];
  const accent = object.accent ?? "";
  const [draft, setDraft] = useState("");

  const setTags = (next: string[]) =>
    dispatch({ type: "UpdateObject", id: object.id, patch: { tags: normalizeTags(next) } });

  const addDraft = () => {
    const tag = draft.trim();
    setDraft("");
    if (!tag || tags.length >= MAX_TAGS) return;
    if (tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return;
    setTags([...tags, tag]);
  };

  const unused = suggestions.filter(
    (tag) => !tags.some((existing) => existing.toLowerCase() === tag.toLowerCase()),
  );

  return (
    <section className="mb-4 border-b border-subtle pb-4">
      <div className="flex items-center gap-1.5">
        <span className="mono mr-1">Colour</span>
        <Swatch
          selected={accent === ""}
          label="No colour"
          // Clearing is a swatch like any other, so the control has one shape and one row.
          onClick={() => dispatch({ type: "UpdateObject", id: object.id, patch: { accent: "" } })}
        />
        {MARK_NAMES.map((name) => (
          <Swatch
            key={name}
            selected={accent === name}
            label={MARK_LABELS[name]}
            color={markColor(name)}
            onClick={() =>
              dispatch({
                type: "UpdateObject",
                id: object.id,
                // Clicking the current colour turns it off — the same gesture both ways.
                patch: { accent: accent === name ? "" : name },
              })
            }
          />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-full border border-subtle bg-inset py-0.5 pl-2 pr-1 text-xs text-fg-secondary"
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              onClick={() => setTags(tags.filter((t) => t !== tag))}
              className="grid h-4 w-4 place-items-center rounded-full text-fg-tertiary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
            >
              <span aria-hidden>✕</span>
            </button>
          </span>
        ))}
        {tags.length < MAX_TAGS && (
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={addDraft}
            onKeyDown={(event) => {
              // Comma as well as Enter: people type tag lists, they do not press Enter six times.
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                addDraft();
              }
              if (event.key === "Backspace" && draft === "" && tags.length > 0) {
                setTags(tags.slice(0, -1));
              }
            }}
            maxLength={MAX_TAG_LENGTH}
            placeholder={tags.length ? "Add tag" : "Add a tag"}
            aria-label="Add a tag"
            className="focus-self w-24 min-w-0 flex-1 rounded-sm border border-subtle bg-inset px-2 py-0.5 text-xs text-fg placeholder:text-fg-tertiary"
          />
        )}
      </div>

      {unused.length > 0 && tags.length < MAX_TAGS && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {unused.slice(0, 6).map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setTags([...tags, tag])}
              className="rounded-full px-1.5 py-0.5 text-xs text-fg-tertiary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
            >
              + {tag}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function Swatch({
  selected,
  label,
  color,
  onClick,
}: {
  selected: boolean;
  label: string;
  /** Absent draws the "no colour" swatch: an outline, not a filled grey that reads as a hue. */
  color?: string | undefined;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={selected}
      className={
        "h-5 w-5 rounded-full border transition-[box-shadow,border-color] duration-instant " +
        "ease-out focus-self " +
        (color ? "border-transparent " : "border-strong ") +
        (selected ? "ring-2 ring-accent ring-offset-1 ring-offset-[var(--bg-surface)]" : "")
      }
      style={color ? { background: color } : undefined}
    />
  );
}

/** Every tag in use, most-used first. The order is what makes a filter row worth scanning. */
export function scapeTags(objects: Record<string, ScapeObject>): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const object of Object.values(objects)) {
    for (const tag of object.tags ?? []) {
      const key = tag.toLowerCase();
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
