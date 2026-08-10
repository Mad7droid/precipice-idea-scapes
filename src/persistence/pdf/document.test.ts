import { describe, expect, it } from "vitest";
import { emptyScape, fixtureScape } from "@/core/fixtures";
import type { ObjectId, Scape, ScapeObject } from "@/core/types";
import {
  arrowHead,
  buildPdfDocument,
  clipToRect,
  diagramBounds,
  entryLines,
  fitTransform,
  outlineEntries,
  paginateOutline,
  ROLE_SIZE,
  sizeOf,
  type OutlinePage,
  type PdfDocumentInput,
  type Rect,
  type TextMeasure,
} from "./document";

/**
 * A measurer with no PDF library behind it: every glyph is half its point size wide, so line
 * counts are arithmetic rather than a guess about Helvetica.
 */
const measure: TextMeasure = {
  wrap(text, widthPt, role, sizePt) {
    const perChar = (sizePt ?? ROLE_SIZE[role]) * 0.5;
    const perLine = Math.max(1, Math.floor(widthPt / perChar));
    const words = String(text).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [""];
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > perLine && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  },
  lineHeight(role, sizePt) {
    return (sizePt ?? ROLE_SIZE[role]) * 1.35;
  },
};

const inputFor = (scape: Scape, over: Partial<PdfDocumentInput> = {}): PdfDocumentInput => ({
  scape,
  types: [
    { type: "note", label: "Note", color: "#8a6a3d" },
    { type: "journey", label: "Journey", color: "#4e8c86" },
    { type: "wireframe", label: "Wireframe", color: "#5b6bae" },
  ],
  describe: (object) => [{ lines: [{ text: `about ${object.title}` }] }],
  generatedAt: Date.UTC(2026, 7, 10),
  ...over,
});

const objectAt = (id: string, over: Partial<ScapeObject> = {}): ScapeObject => ({
  id,
  type: "note",
  title: id,
  data: { body: "" },
  x: 0,
  y: 0,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

function scapeOf(objects: ScapeObject[]): Scape {
  const scape = emptyScape("scp_test", "Test scape");
  for (const object of objects) scape.objects[object.id] = object;
  scape.objectOrder = objects.map((object) => object.id);
  return scape;
}

describe("card sizes", () => {
  it("uses the measured size when the canvas has one", () => {
    const object = objectAt("obj_a", { type: "journey" });
    expect(sizeOf(object, { obj_a: { width: 300, height: 412 } })).toEqual({
      width: 300,
      height: 412,
    });
  });

  it("falls back to a per-type default for an object the canvas never measured", () => {
    expect(sizeOf(objectAt("obj_a", { type: "journey" })).height).toBe(168);
    expect(sizeOf(objectAt("obj_b", { type: "note" })).height).toBe(116);
    expect(sizeOf(objectAt("obj_c", { type: "made-up" })).height).toBe(130);
  });

  it("clamps a stored width into the range a card can actually be", () => {
    expect(sizeOf(objectAt("obj_a", { width: 40 })).width).toBe(200);
    expect(sizeOf(objectAt("obj_b", { width: 4000 })).width).toBe(900);
  });
});

describe("diagram bounds", () => {
  it("covers every card in the scape", () => {
    const scape = scapeOf([
      objectAt("obj_a", { x: 0, y: 0 }),
      objectAt("obj_b", { x: 400, y: 250 }),
    ]);
    expect(diagramBounds(scape)).toEqual({ minX: 0, minY: 0, maxX: 620, maxY: 366 });
  });

  it("is exactly one card for a scape with one object", () => {
    const scape = scapeOf([objectAt("obj_a", { x: 10, y: 20 })]);
    expect(diagramBounds(scape)).toEqual({ minX: 10, minY: 20, maxX: 230, maxY: 136 });
  });

  it("is null for an empty scape, so the caller can print an empty state", () => {
    expect(diagramBounds(emptyScape("scp_empty"))).toBeNull();
  });

  it("skips an id left in objectOrder after its object is gone", () => {
    const scape = scapeOf([objectAt("obj_a"), objectAt("obj_b", { x: 9000, y: 9000 })]);
    delete scape.objects.obj_b;
    expect(diagramBounds(scape)?.maxX).toBe(220);
  });
});

describe("scale to fit", () => {
  const frame: Rect = { x: 36, y: 62, w: 770, h: 480 };

  it("scales a wide scape by width and centres it vertically", () => {
    const fit = fitTransform({ minX: 0, minY: 0, maxX: 7700, maxY: 480 }, frame);
    expect(fit.scale).toBeCloseTo(0.1);
    expect(fit.dx).toBeCloseTo(36);
    expect(fit.dy).toBeCloseTo(62 + (480 - 48) / 2);
  });

  it("scales a tall scape by height", () => {
    const fit = fitTransform({ minX: 0, minY: 0, maxX: 100, maxY: 4800 }, frame);
    expect(fit.scale).toBeCloseTo(0.1);
  });

  it("never blows a small scape up past 1:1, and centres it instead", () => {
    const fit = fitTransform({ minX: 0, minY: 0, maxX: 220, maxY: 116 }, frame);
    expect(fit.scale).toBe(1);
    expect(fit.dx).toBeCloseTo(36 + (770 - 220) / 2);
    expect(fit.dy).toBeCloseTo(62 + (480 - 116) / 2);
  });

  it("survives zero extent — one object, or a perfect row", () => {
    const fit = fitTransform({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, frame);
    expect(Number.isFinite(fit.scale)).toBe(true);
    expect(Number.isFinite(fit.dx)).toBe(true);
    expect(fit.scale).toBe(1);
  });
});

describe("edges", () => {
  const a: Rect = { x: 0, y: 0, w: 100, h: 100 };

  it("starts and ends on the card borders, not the centres", () => {
    const segment = clipToRect(a, { x: 300, y: 0, w: 100, h: 100 });
    expect(segment).toEqual({ x1: 100, y1: 50, x2: 300, y2: 50 });
  });

  it("clips vertically when one card sits above the other", () => {
    const segment = clipToRect(a, { x: 0, y: 300, w: 100, h: 100 });
    expect(segment).toEqual({ x1: 50, y1: 100, x2: 50, y2: 300 });
  });

  it("draws nothing between two cards that overlap", () => {
    expect(clipToRect(a, { x: 10, y: 10, w: 100, h: 100 })).toBeNull();
    expect(clipToRect(a, a)).toBeNull();
  });

  it("points the arrow at the segment's end, symmetric about it", () => {
    const [tipX, tipY, b1x, b1y, b2x, b2y] = arrowHead(0, 0, 100, 0, 10);
    expect([tipX, tipY]).toEqual([100, 0]);
    expect(b1x).toBeCloseTo(90);
    expect(b2x).toBeCloseTo(90);
    expect(b1y).toBeCloseTo(-b2y);
  });

  it("stays finite for a zero-length segment", () => {
    expect(arrowHead(5, 5, 5, 5, 6).every(Number.isFinite)).toBe(true);
  });
});

describe("outline entries", () => {
  it("groups by type in registry order and keeps objectOrder within a group", () => {
    const groups = outlineEntries(inputFor(fixtureScape()));
    const types = [...new Set(groups.map((entry) => entry.type))];
    expect(types).toEqual(["note", "journey", "wireframe"]);
  });

  it("lists both directions of every relationship, with its label", () => {
    const scape = scapeOf([objectAt("obj_a"), objectAt("obj_b")]);
    scape.relationships.rel_1 = { id: "rel_1", from: "obj_a", to: "obj_b", label: "drives" };
    const [a, b] = outlineEntries(inputFor(scape));
    expect(a?.outgoing).toEqual([{ title: "obj_b", label: "drives" }]);
    expect(a?.incoming).toEqual([]);
    expect(b?.incoming).toEqual([{ title: "obj_a", label: "drives" }]);
  });

  it("says so plainly when an object has no connections", () => {
    const scape = scapeOf([objectAt("obj_a")]);
    const [entry] = outlineEntries(inputFor(scape));
    expect(entryLines(entry!).some((line) => line.text === "No connections.")).toBe(true);
  });

  it("drops a relationship pointing at an object that no longer exists", () => {
    const scape = scapeOf([objectAt("obj_a")]);
    scape.relationships.rel_1 = { id: "rel_1", from: "obj_a", to: "obj_gone" };
    const [entry] = outlineEntries(inputFor(scape));
    expect(entry?.outgoing).toEqual([]);
  });

  it("disambiguates a reference when two blocks share a title", () => {
    const scape = scapeOf([
      objectAt("obj_a", { title: "Sign in" }),
      objectAt("obj_b", { title: "Sign in" }),
      objectAt("obj_c", { title: "Home" }),
    ]);
    scape.relationships.rel_1 = { id: "rel_1", from: "obj_c", to: "obj_a" };
    const entry = outlineEntries(inputFor(scape)).find((e) => e.id === "obj_c");
    expect(entry?.outgoing[0]?.title).toBe("Sign in (obj_a)");
  });

  it("keeps an object whose type this build does not know, under Other", () => {
    const scape = scapeOf([objectAt("obj_a", { type: "hologram" })]);
    const entries = outlineEntries(inputFor(scape));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.typeLabel).toBe("hologram");
  });
});

describe("outline pagination", () => {
  const longEntry = (id: string) => objectAt(id, { title: `Block ${id}` });

  it("fills a page before starting another", () => {
    const scape = scapeOf([objectAt("obj_a"), objectAt("obj_b")]);
    const pages = paginateOutline(inputFor(scape), measure);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.entryIds).toEqual(["obj_a", "obj_b"]);
  });

  it("starts new pages as the scape grows, keeping every entry", () => {
    const objects = Array.from({ length: 40 }, (_, i) => longEntry(`obj_${i}`));
    const pages = paginateOutline(inputFor(scapeOf(objects)), measure);
    expect(pages.length).toBeGreaterThan(1);
    const seen = pages.flatMap((page) => page.entryIds);
    expect(new Set(seen).size).toBe(40);
  });

  it("carries an entry taller than a page onto the next one", () => {
    const scape = scapeOf([objectAt("obj_a")]);
    const input = inputFor(scape, {
      describe: () => [{ lines: Array.from({ length: 200 }, (_, i) => ({ text: `line ${i}` })) }],
    });
    const pages = paginateOutline(input, measure);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[1]?.lines.some((line) => line.text.endsWith("(cont.)"))).toBe(true);
  });

  it("repeats the scape name at the top of every page", () => {
    const objects = Array.from({ length: 40 }, (_, i) => longEntry(`obj_${i}`));
    const pages = paginateOutline(inputFor(scapeOf(objects)), measure);
    for (const page of pages) {
      expect(page.lines[0]?.text).toBe("Test scape");
    }
  });
});

describe("the document", () => {
  it("is one diagram page and nothing to read for an empty scape", () => {
    const doc = buildPdfDocument(inputFor(emptyScape("scp_empty", "Nothing yet")), measure);
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]?.kind).toBe("diagram");
    expect(doc.pages[0]?.lines.some((l) => l.text === "This scape has no blocks yet.")).toBe(true);
    expect(doc.meta.objectCount).toBe(0);
  });

  it("names the file after the scape", () => {
    const doc = buildPdfDocument(inputFor(emptyScape("scp_x", "Onboarding Flow!")), measure);
    expect(doc.filenameBase).toBe("onboarding-flow");
  });

  it("puts the diagram first and the outline after it", () => {
    const doc = buildPdfDocument(inputFor(fixtureScape()), measure);
    expect(doc.pages[0]?.kind).toBe("diagram");
    expect(doc.pages.slice(1).every((page) => page.kind === "outline")).toBe(true);
    expect(doc.meta.objectCount).toBe(12);
  });

  it("numbers every page against the final total", () => {
    const doc = buildPdfDocument(inputFor(fixtureScape()), measure);
    const total = doc.pages.length;
    for (const [index, page] of doc.pages.entries()) {
      expect(page.lines.some((line) => line.text === `Page ${index + 1} of ${total}`)).toBe(true);
    }
  });

  it("drops the diagram's text, and says why, when the fit is too tight to read", () => {
    const scape = scapeOf([
      objectAt("obj_a", { x: 0, y: 0 }),
      objectAt("obj_b", { x: 40000, y: 0 }),
    ]);
    const doc = buildPdfDocument(inputFor(scape), measure);
    const diagram = doc.pages[0];
    if (diagram?.kind !== "diagram") throw new Error("expected a diagram page");
    expect(diagram.legible).toBe(false);
    expect(diagram.nodes.every((node) => node.titleLines.length === 0)).toBe(true);
    expect(diagram.lines.some((line) => line.text.includes("written out in full"))).toBe(true);
  });

  it("writes card text at a readable fit", () => {
    const doc = buildPdfDocument(inputFor(fixtureScape()), measure);
    const diagram = doc.pages[0];
    if (diagram?.kind !== "diagram") throw new Error("expected a diagram page");
    expect(diagram.legible).toBe(true);
    expect(diagram.nodes.some((node) => node.titleLines.length > 0)).toBe(true);
  });

  it("uses live measured heights when the canvas provides them", () => {
    const scape = scapeOf([objectAt("obj_a")]);
    const measured: Record<ObjectId, { width: number; height: number }> = {
      obj_a: { width: 220, height: 600 },
    };
    expect(diagramBounds(scape, measured)?.maxY).toBe(600);
  });
});

describe("outline pages", () => {
  it("carries the entries it drew, for the reader and for us", () => {
    const doc = buildPdfDocument(inputFor(fixtureScape()), measure);
    const outline = doc.pages.filter((page): page is OutlinePage => page.kind === "outline");
    const ids = outline.flatMap((page) => page.entryIds);
    expect(new Set(ids).size).toBe(12);
  });
});
