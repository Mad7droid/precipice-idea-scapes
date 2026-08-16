/**
 * The PDF, as data.
 *
 * Everything that decides *where a mark goes* lives here, and nothing in this file knows that
 * jsPDF exists — it imports only core types. The renderer next door transcribes what this
 * produces and does no arithmetic of its own. That seam is what makes bounding boxes, scale,
 * edge clipping and page breaks testable without loading a PDF library.
 *
 * The one thing a layout cannot do without is text metrics, and those live inside the library.
 * So a `TextMeasure` is injected: the renderer builds one from jsPDF, tests pass a
 * deterministic fake and get exact line counts.
 *
 * Shape of the document: one landscape diagram page, then portrait pages that write out every
 * block in full. A scape squeezed onto one page stops being readable at about twenty objects,
 * so past that the diagram degrades honestly — it drops its text and says so — and the outline
 * carries the meaning.
 */
import type { ObjectId, Scape, ScapeObject } from "@/core/types";
import { filenameFor } from "../download";
import { INK, PAPER } from "./palette";

export type Pt = number;

export interface Rect {
  x: Pt;
  y: Pt;
  w: Pt;
  h: Pt;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface NodeSize {
  width: number;
  height: number;
}

export interface Segment {
  x1: Pt;
  y1: Pt;
  x2: Pt;
  y2: Pt;
}

export type TextRole = "title" | "heading" | "body" | "muted" | "mono" | "caption";

/** Point size each role is set in when the caller does not override it. */
export const ROLE_SIZE: Record<TextRole, Pt> = {
  title: 10.5,
  heading: 8,
  body: 10,
  muted: 9,
  mono: 7.5,
  caption: 7,
};

export interface TextMeasure {
  /** Wraps to `widthPt`, in the given role, at `sizePt` if the caller overrides the default. */
  wrap(text: string, widthPt: Pt, role: TextRole, sizePt?: Pt): string[];
  /** Baseline-to-baseline advance for one line. */
  lineHeight(role: TextRole, sizePt?: Pt): Pt;
}

/** One paragraph of an object's field detail. */
export interface DocumentLine {
  text: string;
  role?: TextRole;
  indent?: 0 | 1 | 2;
}

export interface DocumentSection {
  heading?: string;
  lines: DocumentLine[];
}

/** The registry, projected. Injected so this module never imports `@/core/registry`. */
export interface TypeInfo {
  type: string;
  label: string;
  /** A print hex, already resolved — never a CSS token name. */
  color: string;
}

export interface PdfDocumentInput {
  scape: Scape;
  /** Live measured sizes from the canvas. Missing ids fall back to per-type defaults. */
  measured?: Record<ObjectId, NodeSize>;
  types: TypeInfo[];
  describe: (object: ScapeObject) => DocumentSection[];
  generatedAt: number;
  /** Shown next to the scape name in the header. The starter's label, when there is one. */
  starterLabel?: string;
}

export interface PlacedLine {
  x: Pt;
  y: Pt;
  text: string;
  role: TextRole;
  size: Pt;
  color: string;
  bold?: boolean;
  align?: "left" | "right" | "center";
}

export interface PlacedRule {
  x1: Pt;
  y1: Pt;
  x2: Pt;
  y2: Pt;
  color: string;
}

export interface PlacedDot {
  x: Pt;
  y: Pt;
  r: Pt;
  color: string;
}

export interface DiagramNode {
  id: ObjectId;
  x: Pt;
  y: Pt;
  w: Pt;
  h: Pt;
  radius: Pt;
  color: string;
  bandHeight: Pt;
  typeLabel?: PlacedLine;
  titleLines: PlacedLine[];
  bodyLines: PlacedLine[];
  idLine?: PlacedLine;
}

export interface DiagramEdge {
  segment: Segment;
  /** Three points, tip first — ready to hand straight to a filled triangle. */
  arrow: [Pt, Pt, Pt, Pt, Pt, Pt];
  label?: { pill: Rect; line: PlacedLine };
}

export interface DiagramPage {
  kind: "diagram";
  orientation: "landscape";
  scale: number;
  /** False when the fit is so tight that node text would be unreadable, so it is not drawn. */
  legible: boolean;
  lines: PlacedLine[];
  rules: PlacedRule[];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface OutlinePage {
  kind: "outline";
  orientation: "portrait";
  lines: PlacedLine[];
  rules: PlacedRule[];
  dots: PlacedDot[];
  /** Which objects landed on this page, in order. For tests; the renderer ignores it. */
  entryIds: ObjectId[];
}

export type PdfPage = DiagramPage | OutlinePage;

export interface PdfDocument {
  /** Slug, no extension. */
  filenameBase: string;
  title: string;
  meta: {
    objectCount: number;
    relationshipCount: number;
    generatedAt: number;
  };
  pages: PdfPage[];
}

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

const A4_LONG = 841.89;
const A4_SHORT = 595.28;

export const DIAGRAM_PAGE = { w: A4_LONG, h: A4_SHORT };
export const OUTLINE_PAGE = { w: A4_SHORT, h: A4_LONG };

const DIAGRAM_MARGIN = 36;
const OUTLINE_MARGIN_X = 54;
const OUTLINE_MARGIN_Y = 48;
const HEADER_H = 26;
const FOOTER_H = 18;

/**
 * Card sizes for objects the canvas has not measured — an export from a scape that was never
 * opened, or a node React Flow has not laid out yet.
 *
 * These duplicate private constants in `src/canvas/layout.ts` on purpose: importing them would
 * drag React Flow into a module that has to stay pure and testable. In the editor path they are
 * almost never reached, because the canvas hands over real measured sizes.
 */
const PRINT_FALLBACK_HEIGHT: Record<string, number> = {
  note: 116,
  journey: 168,
  wireframe: 190,
  scape: 220,
};
const PRINT_FALLBACK_WIDTH: Record<string, number> = { wireframe: 380, scape: 380 };
const DEFAULT_HEIGHT = 130;
const DEFAULT_WIDTH = 220;
const MIN_WIDTH = 200;
const MAX_WIDTH = 900;

export function printWidth(object: ScapeObject): number {
  const width = object.width ?? PRINT_FALLBACK_WIDTH[object.type] ?? DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

export function sizeOf(object: ScapeObject, measured?: Record<ObjectId, NodeSize>): NodeSize {
  const live = measured?.[object.id];
  if (live && live.width > 0 && live.height > 0) return live;
  return {
    width: printWidth(object),
    height: PRINT_FALLBACK_HEIGHT[object.type] ?? DEFAULT_HEIGHT,
  };
}

/** Null for a scape with nothing in it — the caller prints an empty state rather than a box. */
export function diagramBounds(scape: Scape, measured?: Record<ObjectId, NodeSize>): Bounds | null {
  let bounds: Bounds | null = null;
  for (const id of scape.objectOrder) {
    const object = scape.objects[id];
    if (!object) continue;
    const size = sizeOf(object, measured);
    const next = {
      minX: object.x,
      minY: object.y,
      maxX: object.x + size.width,
      maxY: object.y + size.height,
    };
    bounds = bounds
      ? {
          minX: Math.min(bounds.minX, next.minX),
          minY: Math.min(bounds.minY, next.minY),
          maxX: Math.max(bounds.maxX, next.maxX),
          maxY: Math.max(bounds.maxY, next.maxY),
        }
      : next;
  }
  return bounds;
}

/**
 * Scale-to-fit, centred.
 *
 * Clamped at 1:1 so a two-object scape prints as two cards rather than two billboards, and
 * centred both ways so a small one sits on the page instead of hugging a corner.
 */
export function fitTransform(
  bounds: Bounds,
  frame: Rect,
  maxScale = 1,
): { scale: number; dx: Pt; dy: Pt } {
  // A single object, or a perfect row, has zero extent on one axis. Guard rather than divide.
  const w = Math.max(bounds.maxX - bounds.minX, 1);
  const h = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min(frame.w / w, frame.h / h, maxScale);
  return {
    scale,
    dx: frame.x + (frame.w - w * scale) / 2 - bounds.minX * scale,
    dy: frame.y + (frame.h - h * scale) / 2 - bounds.minY * scale,
  };
}

/**
 * Trims a centre-to-centre segment back to both card borders, so an arrow starts and ends where
 * the eye expects rather than disappearing under a card. Null when the cards overlap — there is
 * no honest line to draw between them.
 */
export function clipToRect(from: Rect, to: Rect): Segment | null {
  const ax = from.x + from.w / 2;
  const ay = from.y + from.h / 2;
  const bx = to.x + to.w / 2;
  const by = to.y + to.h / 2;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return null;

  const exit = (halfW: number, halfH: number) => {
    const tx = dx === 0 ? Infinity : halfW / Math.abs(dx);
    const ty = dy === 0 ? Infinity : halfH / Math.abs(dy);
    return Math.min(tx, ty);
  };

  const tStart = exit(from.w / 2, from.h / 2);
  const tEnd = 1 - exit(to.w / 2, to.h / 2);
  if (!(tStart < tEnd)) return null;

  return {
    x1: ax + dx * tStart,
    y1: ay + dy * tStart,
    x2: ax + dx * tEnd,
    y2: ay + dy * tEnd,
  };
}

/** Tip first, then the two base corners. A zero-length segment still returns finite points. */
export function arrowHead(x1: Pt, y1: Pt, x2: Pt, y2: Pt, size: Pt): [Pt, Pt, Pt, Pt, Pt, Pt] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  const ux = length === 0 ? 1 : dx / length;
  const uy = length === 0 ? 0 : dy / length;
  const baseX = x2 - ux * size;
  const baseY = y2 - uy * size;
  const halfWidth = size * 0.42;
  return [
    x2,
    y2,
    baseX - uy * halfWidth,
    baseY + ux * halfWidth,
    baseX + uy * halfWidth,
    baseY - ux * halfWidth,
  ];
}

// ---------------------------------------------------------------------------------------------
// The diagram page
// ---------------------------------------------------------------------------------------------

/** Below this, a 13px title lands under 3pt. Cards and edges stay; the words go. */
export const MIN_LEGIBLE_SCALE = 0.22;
/** Below this there is room for a title but not for body text or edge labels. */
const MIN_DETAIL_SCALE = 0.45;
const MIN_ID_SCALE = 0.5;

export function diagramFrame(): Rect {
  return {
    x: DIAGRAM_MARGIN,
    y: DIAGRAM_MARGIN + HEADER_H,
    w: DIAGRAM_PAGE.w - DIAGRAM_MARGIN * 2,
    h: DIAGRAM_PAGE.h - DIAGRAM_MARGIN * 2 - HEADER_H - FOOTER_H,
  };
}

function ellipsise(text: string, keep: number): string {
  return text.length <= keep ? text : `${text.slice(0, Math.max(1, keep - 1)).trimEnd()}…`;
}

export function buildDiagramPage(input: PdfDocumentInput, measure: TextMeasure): DiagramPage {
  const { scape } = input;
  const frame = diagramFrame();
  const lines: PlacedLine[] = [];
  const rules: PlacedRule[] = [];
  const colorFor = (type: string) =>
    input.types.find((t) => t.type === type)?.color ?? INK.tertiary;
  const labelFor = (type: string) => input.types.find((t) => t.type === type)?.label ?? type;

  // Header: the name on the left, what kind of document it is and when, on the right.
  lines.push({
    x: DIAGRAM_MARGIN,
    y: DIAGRAM_MARGIN + 11,
    text: scape.name || "Untitled scape",
    role: "title",
    size: 12,
    color: INK.primary,
    bold: true,
  });
  const stamp = [input.starterLabel, formatDate(input.generatedAt)].filter(Boolean).join(" · ");
  lines.push({
    x: DIAGRAM_PAGE.w - DIAGRAM_MARGIN,
    y: DIAGRAM_MARGIN + 11,
    text: stamp,
    role: "mono",
    size: 7.5,
    color: INK.tertiary,
    align: "right",
  });
  rules.push({
    x1: DIAGRAM_MARGIN,
    y1: DIAGRAM_MARGIN + 18,
    x2: DIAGRAM_PAGE.w - DIAGRAM_MARGIN,
    y2: DIAGRAM_MARGIN + 18,
    color: PAPER.hairline,
  });

  const bounds = diagramBounds(scape, input.measured);
  if (!bounds) {
    lines.push({
      x: DIAGRAM_PAGE.w / 2,
      y: frame.y + frame.h / 2,
      text: "This scape has no blocks yet.",
      role: "body",
      size: 11,
      color: INK.tertiary,
      align: "center",
    });
    return {
      kind: "diagram",
      orientation: "landscape",
      scale: 1,
      legible: true,
      lines,
      rules,
      nodes: [],
      edges: [],
    };
  }

  const { scale, dx, dy } = fitTransform(bounds, frame);
  const legible = scale >= MIN_LEGIBLE_SCALE;
  const detailed = scale >= MIN_DETAIL_SCALE;
  const project = (x: number, y: number) => ({ x: x * scale + dx, y: y * scale + dy });

  const rects = new Map<ObjectId, Rect>();
  const nodes: DiagramNode[] = [];

  for (const id of scape.objectOrder) {
    const object = scape.objects[id];
    if (!object) continue;
    const size = sizeOf(object, input.measured);
    const at = project(object.x, object.y);
    const rect: Rect = { x: at.x, y: at.y, w: size.width * scale, h: size.height * scale };
    rects.set(id, rect);

    const color = colorFor(object.type);
    const pad = Math.max(2.5, 10 * scale);
    const radius = Math.max(1, 3 * scale);
    const bandHeight = Math.max(1.2, 2 * scale);
    const node: DiagramNode = {
      id,
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      radius,
      color,
      bandHeight,
      titleLines: [],
      bodyLines: [],
    };

    if (legible) {
      const titleSize = Math.max(5, 13 * scale);
      const inner = rect.w - pad * 2;
      let cursor = rect.y + bandHeight + pad + titleSize;

      if (detailed) {
        // Colour alone never carries meaning, so the type is written on the card too.
        node.typeLabel = {
          x: rect.x + rect.w - pad,
          y: rect.y + bandHeight + pad + 5,
          text: labelFor(object.type).toLowerCase(),
          role: "mono",
          size: Math.max(4.5, 6.5 * scale),
          color,
          align: "right",
        };
      }

      const titleWidth = detailed ? inner * 0.7 : inner;
      const wrapped = measure
        .wrap(object.title || "Untitled", titleWidth, "title", titleSize)
        .slice(0, 2);
      const lastIndex = wrapped.length - 1;
      for (const [index, text] of wrapped.entries()) {
        node.titleLines.push({
          x: rect.x + pad,
          y: cursor,
          // Two lines is the budget; anything past it ends in an ellipsis rather than a lie.
          text: index === 1 && lastIndex === 1 ? ellipsise(text, 34) : text,
          role: "title",
          size: titleSize,
          color: INK.primary,
          bold: true,
        });
        cursor += titleSize * 1.25;
      }

      if (detailed) {
        const bodySize = Math.max(4.5, 11 * scale);
        const sections = input.describe(object);
        const lead = sections.flatMap((section) => section.lines).slice(0, 4);
        cursor += bodySize * 0.4;
        for (const line of lead) {
          const [first] = measure.wrap(line.text, inner, "body", bodySize);
          if (!first) continue;
          if (cursor > rect.y + rect.h - pad) break;
          node.bodyLines.push({
            x: rect.x + pad,
            y: cursor,
            text: ellipsise(first, 60),
            role: "body",
            size: bodySize,
            color: INK.secondary,
          });
          cursor += bodySize * 1.3;
        }
      }

      if (scale >= MIN_ID_SCALE) {
        node.idLine = {
          x: rect.x + pad,
          y: rect.y + rect.h - pad,
          text: id,
          role: "mono",
          size: Math.max(4.5, 8 * scale),
          color: INK.tertiary,
        };
      }
    }

    nodes.push(node);
  }

  const edges: DiagramEdge[] = [];
  for (const relationship of Object.values(scape.relationships)) {
    const from = rects.get(relationship.from);
    const to = rects.get(relationship.to);
    // A relationship pointing at a deleted object is dropped, not drawn into the void.
    if (!from || !to) continue;
    const segment = clipToRect(from, to);
    if (!segment) continue;

    const headSize = Math.max(2.5, 5 * scale);
    const edge: DiagramEdge = {
      segment,
      arrow: arrowHead(segment.x1, segment.y1, segment.x2, segment.y2, headSize),
    };

    if (relationship.label && detailed) {
      const size = Math.max(5, 6.5 * scale);
      const text = ellipsise(relationship.label, 28);
      const width = text.length * size * 0.55 + size;
      const height = size * 1.7;
      const midX = (segment.x1 + segment.x2) / 2;
      const midY = (segment.y1 + segment.y2) / 2;
      edge.label = {
        pill: { x: midX - width / 2, y: midY - height / 2, w: width, h: height },
        line: {
          x: midX,
          y: midY + size * 0.35,
          text,
          role: "mono",
          size,
          color: INK.secondary,
          align: "center",
        },
      };
    }

    edges.push(edge);
  }

  if (!legible) {
    lines.push({
      x: DIAGRAM_MARGIN,
      y: DIAGRAM_PAGE.h - DIAGRAM_MARGIN,
      text: `Diagram scaled to ${Math.round(scale * 100)}%. Every block is written out in full from page 2.`,
      role: "caption",
      size: 8,
      color: INK.tertiary,
    });
  }

  return { kind: "diagram", orientation: "landscape", scale, legible, lines, rules, nodes, edges };
}

// ---------------------------------------------------------------------------------------------
// The outline pages
// ---------------------------------------------------------------------------------------------

export interface OutlineLink {
  title: string;
  label?: string;
}

export interface OutlineEntry {
  id: ObjectId;
  type: string;
  typeLabel: string;
  color: string;
  title: string;
  sections: DocumentSection[];
  outgoing: OutlineLink[];
  incoming: OutlineLink[];
}

export interface OutlineGroup {
  heading: string;
  entries: OutlineEntry[];
}

/**
 * Groups exactly as the outline rail does — registry order for the sections, `objectOrder`
 * within one — so the printed document and the app agree about what comes first.
 */
export function outlineGroups(input: PdfDocumentInput): OutlineGroup[] {
  const { scape } = input;
  const order = new Map(input.types.map((type, index) => [type.type, index]));
  const groups = new Map<string, OutlineEntry[]>();

  const titleOf = (id: ObjectId) => scape.objects[id]?.title || "Untitled";
  // Two blocks can share a title. When they do, the reference carries the id so it is not a
  // guess which one is meant.
  const ambiguous = new Set<string>();
  const seen = new Set<string>();
  for (const id of scape.objectOrder) {
    const title = titleOf(id);
    if (seen.has(title)) ambiguous.add(title);
    seen.add(title);
  }
  const reference = (id: ObjectId): string => {
    const title = titleOf(id);
    return ambiguous.has(title) ? `${title} (${id})` : title;
  };

  for (const id of scape.objectOrder) {
    const object = scape.objects[id];
    if (!object) continue;
    const info = input.types.find((t) => t.type === object.type);
    const outgoing: OutlineLink[] = [];
    const incoming: OutlineLink[] = [];
    for (const relationship of Object.values(scape.relationships)) {
      if (relationship.from === id && scape.objects[relationship.to]) {
        outgoing.push({
          title: reference(relationship.to),
          ...(relationship.label ? { label: relationship.label } : {}),
        });
      }
      if (relationship.to === id && scape.objects[relationship.from]) {
        incoming.push({
          title: reference(relationship.from),
          ...(relationship.label ? { label: relationship.label } : {}),
        });
      }
    }

    const entry: OutlineEntry = {
      id,
      type: object.type,
      typeLabel: info?.label ?? object.type,
      color: info?.color ?? INK.tertiary,
      title: object.title || "Untitled",
      sections: input.describe(object),
      outgoing,
      incoming,
    };
    // A type with no plugin still prints, under its own heading at the end.
    const key = info ? object.type : "￿other";
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }

  return [...groups.entries()]
    .sort(
      (a, b) =>
        (order.get(a[0]) ?? Number.MAX_SAFE_INTEGER) - (order.get(b[0]) ?? Number.MAX_SAFE_INTEGER),
    )
    .map(([key, entries]) => ({
      heading: input.types.find((t) => t.type === key)?.label ?? "Other",
      entries,
    }));
}

export function outlineEntries(input: PdfDocumentInput): OutlineEntry[] {
  return outlineGroups(input).flatMap((group) => group.entries);
}

/** The lines an entry contributes, before anything knows how wide the page is. */
export function entryLines(entry: OutlineEntry): DocumentLine[] {
  const lines: DocumentLine[] = [{ text: entry.id, role: "mono" }];

  for (const section of entry.sections) {
    if (section.heading) lines.push({ text: section.heading, role: "heading" });
    for (const line of section.lines) lines.push(line);
  }

  if (entry.outgoing.length === 0 && entry.incoming.length === 0) {
    lines.push({ text: "No connections.", role: "muted" });
  } else {
    if (entry.outgoing.length > 0) {
      lines.push({ text: "Connects to", role: "heading" });
      for (const link of entry.outgoing) {
        lines.push({
          text: `→ ${link.title}${link.label ? ` · ${link.label}` : ""}`,
          role: "body",
          indent: 1,
        });
      }
    }
    if (entry.incoming.length > 0) {
      lines.push({ text: "Connected from", role: "heading" });
      for (const link of entry.incoming) {
        lines.push({
          text: `← ${link.title}${link.label ? ` · ${link.label}` : ""}`,
          role: "body",
          indent: 1,
        });
      }
    }
  }

  return lines;
}

interface Chunk {
  kind: "summary" | "section" | "entry";
  id?: ObjectId;
  heading?: string;
  headingColor?: string;
  title?: string;
  chip?: { label: string; color: string };
  lines: Array<{ text: string; role: TextRole; indent: number }>;
  spaceBefore: Pt;
}

const INDENT = 12;

function summaryChunk(input: PdfDocumentInput, groups: OutlineGroup[]): Chunk {
  const { scape } = input;
  const degree = new Map<ObjectId, number>();
  for (const relationship of Object.values(scape.relationships)) {
    for (const id of [relationship.from, relationship.to]) {
      if (scape.objects[id]) degree.set(id, (degree.get(id) ?? 0) + 1);
    }
  }
  const unconnected = scape.objectOrder.filter((id) => scape.objects[id] && !degree.has(id)).length;
  const relationshipCount = Object.values(scape.relationships).filter(
    (r) => scape.objects[r.from] && scape.objects[r.to],
  ).length;

  const lines: Array<{ text: string; role: TextRole; indent: number }> = groups.map((group) => ({
    text: `${group.entries.length} ${group.heading.toLowerCase()}${group.entries.length === 1 ? "" : "s"}`,
    role: "body" as TextRole,
    indent: 1,
  }));
  lines.push({
    text: `${relationshipCount} ${relationshipCount === 1 ? "relationship" : "relationships"}`,
    role: "body",
    indent: 1,
  });
  if (unconnected > 0) {
    lines.push({
      text: `${unconnected} unconnected ${unconnected === 1 ? "block" : "blocks"}`,
      role: "muted",
      indent: 1,
    });
  }

  return { kind: "summary", heading: "Summary", lines, spaceBefore: 0 };
}

/**
 * Greedy fill, with three rules that stop a printed document reading like a machine dump: a
 * section heading never sits alone at the foot of a page, an entry taller than a page splits at
 * a line boundary and says `(cont.)`, and every page repeats the scape name.
 */
export function paginateOutline(input: PdfDocumentInput, measure: TextMeasure): OutlinePage[] {
  const groups = outlineGroups(input);
  if (groups.length === 0) return [];

  const frame: Rect = {
    x: OUTLINE_MARGIN_X,
    y: OUTLINE_MARGIN_Y + HEADER_H,
    w: OUTLINE_PAGE.w - OUTLINE_MARGIN_X * 2,
    h: OUTLINE_PAGE.h - OUTLINE_MARGIN_Y * 2 - HEADER_H - FOOTER_H,
  };

  const chunks: Chunk[] = [summaryChunk(input, groups)];
  for (const group of groups) {
    chunks.push({ kind: "section", heading: group.heading, lines: [], spaceBefore: 18 });
    for (const entry of group.entries) {
      const wrapped: Chunk["lines"] = [];
      for (const line of entryLines(entry)) {
        const role = line.role ?? "body";
        const indent = (line.indent ?? 0) * INDENT;
        const pieces = measure.wrap(line.text, frame.w - indent, role);
        for (const text of pieces.length > 0 ? pieces : [""]) {
          wrapped.push({ text, role, indent });
        }
      }
      chunks.push({
        kind: "entry",
        id: entry.id,
        title: entry.title,
        chip: { label: entry.typeLabel, color: entry.color },
        lines: wrapped,
        spaceBefore: 12,
      });
    }
  }

  const pages: OutlinePage[] = [];
  let page: OutlinePage | null = null;
  let cursor = frame.y;
  let section = "";
  let sectionOnPage = "";

  const newPage = () => {
    page = {
      kind: "outline",
      orientation: "portrait",
      lines: [
        {
          x: OUTLINE_MARGIN_X,
          y: OUTLINE_MARGIN_Y,
          text: input.scape.name || "Untitled scape",
          role: "mono",
          size: 7.5,
          color: INK.tertiary,
        },
      ],
      rules: [
        {
          x1: OUTLINE_MARGIN_X,
          y1: OUTLINE_MARGIN_Y + 6,
          x2: OUTLINE_PAGE.w - OUTLINE_MARGIN_X,
          y2: OUTLINE_MARGIN_Y + 6,
          color: PAPER.hairline,
        },
      ],
      dots: [],
      entryIds: [],
    };
    pages.push(page);
    cursor = frame.y;
    sectionOnPage = "";
    return page;
  };

  const current = () => page ?? newPage();
  const bottom = frame.y + frame.h;

  const heightOf = (chunk: Chunk): Pt => {
    let height = chunk.spaceBefore;
    if (chunk.kind === "entry") height += measure.lineHeight("title") + 4;
    if (chunk.heading) height += measure.lineHeight("heading") + 4;
    for (const line of chunk.lines) height += measure.lineHeight(line.role);
    return height;
  };

  const writeSectionHeading = (heading: string, suffix: boolean) => {
    const target = current();
    target.lines.push({
      x: OUTLINE_MARGIN_X,
      y: cursor + ROLE_SIZE.heading,
      text: (suffix ? `${heading} (cont.)` : heading).toUpperCase(),
      role: "heading",
      size: ROLE_SIZE.heading,
      color: INK.tertiary,
    });
    cursor += measure.lineHeight("heading") + 6;
    sectionOnPage = heading;
  };

  for (const chunk of chunks) {
    if (chunk.kind === "section") {
      section = chunk.heading ?? "";
      // A heading with no room for the entry under it belongs on the next page, not this one.
      const orphan = cursor + chunk.spaceBefore + measure.lineHeight("heading") * 4 > bottom;
      if (orphan && page) newPage();
      else cursor += chunk.spaceBefore;
      writeSectionHeading(section, false);
      continue;
    }

    // The fit test below reads `cursor`, which only means anything once a page exists.
    if (!page) newPage();
    // A short entry moves whole rather than leaving two lines stranded at the foot of a page.
    if (chunk.kind === "entry" && cursor + Math.min(heightOf(chunk), 90) > bottom) {
      newPage();
      if (section && sectionOnPage !== section) writeSectionHeading(section, true);
    }

    cursor += chunk.spaceBefore;
    let head = current();

    if (chunk.kind === "entry") {
      head.entryIds.push(chunk.id as ObjectId);
      const titleY = cursor + ROLE_SIZE.title;
      head.lines.push({
        x: OUTLINE_MARGIN_X,
        y: titleY,
        text: chunk.title ?? "Untitled",
        role: "title",
        size: ROLE_SIZE.title,
        color: INK.primary,
        bold: true,
      });
      if (chunk.chip) {
        head.dots.push({
          x: OUTLINE_PAGE.w - OUTLINE_MARGIN_X - chunk.chip.label.length * 4 - 8,
          y: titleY - 3,
          r: 2,
          color: chunk.chip.color,
        });
        head.lines.push({
          x: OUTLINE_PAGE.w - OUTLINE_MARGIN_X,
          y: titleY,
          text: chunk.chip.label.toLowerCase(),
          role: "mono",
          size: 7,
          color: INK.secondary,
          align: "right",
        });
      }
      cursor = titleY + 6;
    } else if (chunk.heading) {
      head.lines.push({
        x: OUTLINE_MARGIN_X,
        y: cursor + ROLE_SIZE.heading,
        text: chunk.heading.toUpperCase(),
        role: "heading",
        size: ROLE_SIZE.heading,
        color: INK.tertiary,
      });
      cursor += measure.lineHeight("heading") + 6;
    }

    for (const line of chunk.lines) {
      if (cursor + measure.lineHeight(line.role) > bottom) {
        // An entry longer than a page carries on rather than being cut off silently.
        head = newPage();
        if (section && sectionOnPage !== section) writeSectionHeading(section, true);
        if (chunk.kind === "entry") {
          head.lines.push({
            x: OUTLINE_MARGIN_X,
            y: cursor + ROLE_SIZE.title,
            text: `${chunk.title ?? "Untitled"} (cont.)`,
            role: "title",
            size: ROLE_SIZE.title,
            color: INK.primary,
            bold: true,
          });
          if (chunk.id) head.entryIds.push(chunk.id);
          cursor += measure.lineHeight("title") + 6;
        }
      }
      const size = ROLE_SIZE[line.role];
      head.lines.push({
        x: OUTLINE_MARGIN_X + line.indent,
        y: cursor + size,
        text: line.text,
        role: line.role,
        size,
        color: line.role === "muted" || line.role === "mono" ? INK.tertiary : INK.primary,
      });
      cursor += measure.lineHeight(line.role);
    }

    if (chunk.kind === "entry") {
      head.rules.push({
        x1: OUTLINE_MARGIN_X,
        y1: cursor + 6,
        x2: OUTLINE_PAGE.w - OUTLINE_MARGIN_X,
        y2: cursor + 6,
        color: PAPER.hairline,
      });
      cursor += 8;
    }
  }

  return pages;
}

// ---------------------------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------------------------

function formatDate(at: number): string {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Footers are stamped last, because only then is the total page count known. */
function stampFooters(pages: PdfPage[], generatedAt: number): void {
  for (const [index, page] of pages.entries()) {
    const width = page.kind === "diagram" ? DIAGRAM_PAGE.w : OUTLINE_PAGE.w;
    const height = page.kind === "diagram" ? DIAGRAM_PAGE.h : OUTLINE_PAGE.h;
    const margin = page.kind === "diagram" ? DIAGRAM_MARGIN : OUTLINE_MARGIN_X;
    const baseline = height - (page.kind === "diagram" ? DIAGRAM_MARGIN : OUTLINE_MARGIN_Y) + 10;
    if (page.kind === "outline") {
      page.lines.push({
        x: margin,
        y: baseline,
        text: formatDate(generatedAt),
        role: "mono",
        size: 7,
        color: INK.tertiary,
      });
    }
    page.lines.push({
      x: width - margin,
      y: baseline,
      text: `Page ${index + 1} of ${pages.length}`,
      role: "mono",
      size: 7,
      color: INK.tertiary,
      align: "right",
    });
  }
}

export function buildPdfDocument(input: PdfDocumentInput, measure: TextMeasure): PdfDocument {
  const objectCount = input.scape.objectOrder.filter((id) => input.scape.objects[id]).length;
  const pages: PdfPage[] = [buildDiagramPage(input, measure)];
  // An empty scape gets the diagram page and its empty state, and nothing to write out.
  if (objectCount > 0) pages.push(...paginateOutline(input, measure));
  stampFooters(pages, input.generatedAt);

  return {
    filenameBase: filenameFor(input.scape.name),
    title: input.scape.name || "Untitled scape",
    meta: {
      objectCount,
      relationshipCount: Object.keys(input.scape.relationships).length,
      generatedAt: input.generatedAt,
    },
    pages,
  };
}
