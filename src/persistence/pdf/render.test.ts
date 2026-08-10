import { describe, expect, it } from "vitest";
import { fixtureScape } from "@/core/fixtures";
import { buildPdfDocument } from "./document";
import { printTypes } from "./index";
import { describeObject } from "./describe";
import { jsPdfMeasure, newPdf, renderPdf } from "./render";

/**
 * The one test that puts the real jsPDF behind the layout.
 *
 * `document.test.ts` covers the arithmetic with a fake measurer, which is the right way to
 * test a layout. This covers what that cannot: that the library still loads, measures and
 * transcribes. It matters more than it looks — `vite.config.ts` aliases jsPDF's raster
 * dependencies (html2canvas, canvg, dompurify) to a stub that throws, and this is what fails
 * if the export ever starts reaching for one of them.
 */
function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe("renderPdf", () => {
  const render = () => {
    const scape = fixtureScape();
    const doc = buildPdfDocument(
      {
        scape,
        types: printTypes(),
        describe: describeObject,
        generatedAt: Date.UTC(2026, 7, 11),
      },
      jsPdfMeasure(newPdf()),
    );
    return { doc, blob: renderPdf(doc) };
  };

  it("transcribes the fixture scape into a real PDF", async () => {
    const { doc, blob } = render();

    expect(doc.pages.length).toBeGreaterThan(1);
    expect(blob.type).toBe("application/pdf");

    // jsdom's Blob has no arrayBuffer(), and node's Response does not accept one, so the
    // bytes come back through the reader jsdom does implement.
    const bytes = new Uint8Array(await readBlob(blob));
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
    // A header and nothing else would still pass the check above.
    expect(blob.size).toBeGreaterThan(2000);
  });

  it("measures through jsPDF rather than returning the text unwrapped", () => {
    const measure = jsPdfMeasure(newPdf());
    const long = "onboarding ".repeat(40);

    expect(measure.wrap(long, 120, "body").length).toBeGreaterThan(1);
    expect(measure.wrap("short", 400, "body")).toEqual(["short"]);
    expect(measure.lineHeight("body")).toBeGreaterThan(0);
  });
});
