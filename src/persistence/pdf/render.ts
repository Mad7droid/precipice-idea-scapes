/**
 * The transcription pass.
 *
 * The only file that imports jsPDF, and the only one that may. It does no arithmetic — every
 * coordinate arrives resolved from `document.ts`. Keeping it this thin is what lets the layout
 * be tested without a PDF library, and what keeps the library out of the initial bundle: it is
 * only ever reached through a dynamic import.
 */
import { jsPDF } from "jspdf";
import {
  DIAGRAM_PAGE,
  OUTLINE_PAGE,
  ROLE_SIZE,
  type PdfDocument,
  type PdfPage,
  type PlacedLine,
  type TextMeasure,
  type TextRole,
} from "./document";
import { PAPER } from "./palette";

/** Monospace is machine truth — ids, timestamps, type keys. Everything else is the sans. */
const ROLE_FONT: Record<TextRole, "helvetica" | "courier"> = {
  title: "helvetica",
  heading: "courier",
  body: "helvetica",
  muted: "helvetica",
  mono: "courier",
  caption: "helvetica",
};

export function newPdf(): jsPDF {
  return new jsPDF({ unit: "pt", format: "a4", orientation: "landscape", compress: true });
}

/** Wrapping is the one thing the layout cannot do alone: the metrics live in here. */
export function jsPdfMeasure(pdf: jsPDF): TextMeasure {
  return {
    wrap(text, widthPt, role, sizePt) {
      const size = sizePt ?? ROLE_SIZE[role];
      pdf.setFont(ROLE_FONT[role], role === "title" ? "bold" : "normal");
      pdf.setFontSize(size);
      const lines = pdf.splitTextToSize(text ?? "", Math.max(widthPt, 1)) as string[] | string;
      return Array.isArray(lines) ? lines : [lines];
    },
    lineHeight(role, sizePt) {
      return (sizePt ?? ROLE_SIZE[role]) * 1.35;
    },
  };
}

export function renderPdf(doc: PdfDocument): Blob {
  const pdf = newPdf();
  pdf.setProperties({
    title: doc.title,
    subject: "Scape export",
    creator: "Precipice",
  });

  for (const [index, page] of doc.pages.entries()) {
    if (index > 0) {
      pdf.addPage(
        page.orientation === "landscape"
          ? [DIAGRAM_PAGE.w, DIAGRAM_PAGE.h]
          : [OUTLINE_PAGE.w, OUTLINE_PAGE.h],
        page.orientation,
      );
    }
    drawPage(pdf, page);
  }

  return pdf.output("blob");
}

function drawPage(pdf: jsPDF, page: PdfPage): void {
  if (page.kind === "diagram") {
    for (const edge of page.edges) {
      pdf.setDrawColor(PAPER.edge);
      pdf.setLineWidth(Math.max(0.4, 0.9 * page.scale));
      pdf.line(edge.segment.x1, edge.segment.y1, edge.segment.x2, edge.segment.y2);
      pdf.setFillColor(PAPER.edge);
      pdf.triangle(...edge.arrow, "F");
    }
    // Labels sit on top of the lines they belong to, in a pill, so text never crosses a stroke.
    for (const edge of page.edges) {
      if (!edge.label) continue;
      pdf.setFillColor(PAPER.page);
      pdf.setDrawColor(PAPER.hairline);
      pdf.setLineWidth(0.3);
      const { pill } = edge.label;
      pdf.roundedRect(pill.x, pill.y, pill.w, pill.h, 2, 2, "FD");
      drawLine(pdf, edge.label.line);
    }

    for (const node of page.nodes) {
      pdf.setFillColor(PAPER.card);
      pdf.setDrawColor(PAPER.hairline);
      pdf.setLineWidth(0.5);
      pdf.roundedRect(node.x, node.y, node.w, node.h, node.radius, node.radius, "FD");
      // Inset past the corner radius, so the band reads as a bar rather than a smudge.
      pdf.setFillColor(node.color);
      pdf.rect(
        node.x + node.radius,
        node.y,
        Math.max(node.w - node.radius * 2, 0),
        node.bandHeight,
        "F",
      );
      if (node.typeLabel) drawLine(pdf, node.typeLabel);
      for (const line of node.titleLines) drawLine(pdf, line);
      for (const line of node.bodyLines) drawLine(pdf, line);
      if (node.idLine) drawLine(pdf, node.idLine);
    }
  } else {
    for (const dot of page.dots) {
      pdf.setFillColor(dot.color);
      pdf.circle(dot.x, dot.y, dot.r, "F");
    }
  }

  for (const rule of page.rules) {
    pdf.setDrawColor(rule.color);
    pdf.setLineWidth(0.5);
    pdf.line(rule.x1, rule.y1, rule.x2, rule.y2);
  }
  for (const line of page.lines) drawLine(pdf, line);
}

function drawLine(pdf: jsPDF, line: PlacedLine): void {
  if (!line.text) return;
  pdf.setFont(ROLE_FONT[line.role], line.bold ? "bold" : "normal");
  pdf.setFontSize(line.size);
  pdf.setTextColor(line.color);
  pdf.text(line.text, line.x, line.y, line.align ? { align: line.align } : undefined);
}
