/**
 * Export a scape as a readable document.
 *
 * A `.scape` re-opens in Precipice and is useless to anyone who does not have it. This is the
 * other half: a map on page one, then every block written out in full — vector throughout, so
 * the text is selectable and searchable rather than a screenshot of a canvas.
 *
 * jsPDF loads only when someone actually exports, the way the AI SDK does in
 * `src/ai/useGeneration.ts`. It has no business in the bundle you pay for on first paint.
 */
import { allPlugins } from "@/core/registry";
import type { ObjectId, Scape } from "@/core/types";
import { starterFor } from "@/starters";
import { downloadBlob } from "../download";
import { describeObject } from "./describe";
import { buildPdfDocument, type NodeSize, type TypeInfo } from "./document";
import { printColor } from "./palette";

export interface PdfExportResult {
  pages: number;
  objects: number;
}

export interface PdfExportOptions {
  /** Live measured node sizes from the canvas. Without them the diagram uses type defaults. */
  measured?: Record<ObjectId, NodeSize>;
  now?: number;
}

/** The registry, flattened to what the layout needs — plain data, with colours resolved. */
export function printTypes(): TypeInfo[] {
  return allPlugins().map((plugin) => ({
    type: plugin.type,
    label: plugin.label,
    color: printColor(plugin.color),
  }));
}

export async function exportScapePdf(
  scape: Scape,
  options: PdfExportOptions = {},
): Promise<PdfExportResult> {
  const { newPdf, jsPdfMeasure, renderPdf } = await import("./render");
  const starter = starterFor(scape);

  const doc = buildPdfDocument(
    {
      scape,
      ...(options.measured ? { measured: options.measured } : {}),
      types: printTypes(),
      describe: describeObject,
      generatedAt: options.now ?? Date.now(),
      ...(starter.id !== "blank" ? { starterLabel: starter.label } : {}),
    },
    jsPdfMeasure(newPdf()),
  );

  downloadBlob(renderPdf(doc), `${doc.filenameBase}.pdf`);
  return { pages: doc.pages.length, objects: doc.meta.objectCount };
}
