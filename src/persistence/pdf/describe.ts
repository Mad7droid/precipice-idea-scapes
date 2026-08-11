/**
 * An object, written out.
 *
 * `toText` on a plugin is one clamped line tuned for the model; a printed document needs the
 * whole thing — the note's prose, the journey's steps, the wireframe's elements. That detail
 * belongs on the plugin, as a `toDocument?` sibling to `toText`. But `src/core/registry.ts` is
 * frozen and the plugins are another workstream's directory, so for now the knowledge lives
 * here, behind one function. Migrating later is a one-line swap at the call site:
 *
 *     getPlugin(o.type)?.toDocument?.(o) ?? describeObject(o)
 *
 * The plugin's own schema is used to validate — a core interface, read not written — so this
 * never assumes a shape it has not checked. Anything unrecognised, including data that fails
 * its own schema, still prints: a generic walk is a worse read than a tailored one, and much
 * better than a blank space where a block should be.
 */
import { richTextToBlocks, richTextToPlainText } from "@/objects/markdownText";
import { getPlugin } from "@/core/registry";
import type { ScapeObject } from "@/core/types";
import type { DocumentLine, DocumentSection } from "./document";

const MAX_LINE = 200;
const MAX_GENERIC_ROWS = 8;

export function describeObject(object: ScapeObject): DocumentSection[] {
  const plugin = getPlugin(object.type);
  const parsed = plugin ? plugin.schema.safeParse(object.data) : null;
  const data: unknown = parsed?.success ? parsed.data : object.data;

  if (parsed?.success) {
    switch (object.type) {
      case "note":
        return describeNote(data);
      case "journey":
        return describeJourney(data);
      case "wireframe":
        return describeWireframe(data);
    }
  }
  return describeGenerically(object.data);
}

/** The lead lines for a diagram card — the first few words of whatever the object is. */
export function leadText(sections: DocumentSection[], max: number): string[] {
  return sections
    .flatMap((section) => section.lines)
    .filter((line) => line.role !== "heading")
    .slice(0, max)
    .map((line) => line.text);
}

/**
 * Note bodies are Markdown. Printing them raw puts `**bold**` on the page, asterisks and
 * all, which is the one thing a PDF export must not do to a formatted document.
 *
 * `richTextToBlocks` strips inline syntax and keeps list structure — a bullet list stays a
 * bullet list rather than collapsing into a run-on paragraph, which is what the flat
 * `richTextToPlainText` (tuned for the model's one-line budget) would do to it.
 */
function describeNote(data: unknown): DocumentSection[] {
  const body =
    typeof (data as { body?: unknown }).body === "string" ? (data as { body: string }).body : "";
  const blocks = richTextToBlocks(body);
  if (blocks.length === 0) return [{ lines: [{ text: "Empty.", role: "muted" }] }];
  return [
    {
      lines: blocks.map((block) => ({
        text: clamp(block.text, 1200),
        ...(block.list ? { indent: 1 as const } : {}),
      })),
    },
  ];
}

interface Step {
  label?: unknown;
  detail?: unknown;
}

function describeJourney(data: unknown): DocumentSection[] {
  const steps = (data as { steps?: unknown }).steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    return [{ heading: "Steps", lines: [{ text: "No steps.", role: "muted" }] }];
  }
  const lines: DocumentLine[] = [];
  for (const [index, raw] of steps.entries()) {
    const step = raw as Step;
    const label =
      typeof step.label === "string" && step.label.trim() ? step.label : "Untitled step";
    lines.push({ text: `${index + 1}. ${clamp(label, MAX_LINE)}` });
    if (typeof step.detail === "string" && step.detail.trim()) {
      // Step details are Markdown too. Flattened rather than blocked: a step detail is one
      // muted line under its label, and a list inside it would break that rhythm.
      lines.push({
        text: clamp(richTextToPlainText(step.detail), MAX_LINE),
        role: "muted",
        indent: 1,
      });
    }
  }
  return [{ heading: "Steps", lines }];
}

interface Primitive {
  kind?: unknown;
  label?: unknown;
  span?: unknown;
  align?: unknown;
  size?: unknown;
}

function describeWireframe(data: unknown): DocumentSection[] {
  const columns =
    typeof (data as { columns?: unknown }).columns === "number"
      ? (data as { columns: number }).columns
      : 12;
  const primitives = (data as { primitives?: unknown }).primitives;
  const lines: DocumentLine[] = [{ text: `${columns}-column grid`, role: "muted" }];

  if (!Array.isArray(primitives) || primitives.length === 0) {
    lines.push({ text: "No elements.", role: "muted" });
    return [{ heading: "Layout", lines }];
  }

  for (const raw of primitives) {
    const primitive = raw as Primitive;
    const kind = typeof primitive.kind === "string" ? primitive.kind : "element";
    const label =
      typeof primitive.label === "string" && primitive.label.trim() ? primitive.label : "";
    // A section primitive is a region header, so everything after it reads as sitting under it.
    if (kind === "section") {
      lines.push({ text: label || "Section", role: "heading", indent: 1 });
      continue;
    }
    const traits = [
      kind,
      typeof primitive.span === "number" ? `${primitive.span}/${columns}` : null,
      typeof primitive.align === "string" ? primitive.align : null,
      typeof primitive.size === "string" ? primitive.size : null,
    ]
      .filter(Boolean)
      .join(", ");
    lines.push({ text: `${label ? `${clamp(label, 80)} — ` : ""}${traits}`, indent: 1 });
  }

  return [{ heading: "Layout", lines }];
}

/** For a type this build does not know, or data that no longer matches its schema. */
function describeGenerically(data: Record<string, unknown>): DocumentSection[] {
  const lines: DocumentLine[] = [];
  for (const [key, value] of Object.entries(data ?? {})) {
    if (Array.isArray(value)) {
      lines.push({ text: `${key}: ${value.length} ${value.length === 1 ? "item" : "items"}` });
      for (const item of value.slice(0, MAX_GENERIC_ROWS)) {
        lines.push({ text: clamp(stringify(item), MAX_LINE), role: "muted", indent: 1 });
      }
      if (value.length > MAX_GENERIC_ROWS) {
        lines.push({
          text: `…and ${value.length - MAX_GENERIC_ROWS} more`,
          role: "muted",
          indent: 1,
        });
      }
    } else {
      lines.push({ text: clamp(`${key}: ${stringify(value)}`, MAX_LINE) });
    }
  }
  if (lines.length === 0) lines.push({ text: "Empty.", role: "muted" });
  return [{ lines }];
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value) ?? "—";
  } catch {
    return "—";
  }
}

function clamp(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}
