/**
 * Taking a published scape away with you.
 *
 * The same two formats the editor offers, from the same code: a `.scape` that re-opens in
 * Precipice, and a PDF anyone can read. A reader who can see a document should be able to keep
 * it — the alternative is "Copy & edit" or a screenshot, and one of those is a worse document
 * while the other requires wanting to author.
 *
 * Nothing here reaches the editor: `@/export` is registry-free by construction and the type
 * information comes from the *view* registry, which is the only one this bundle may load.
 * `src/viewer/bundle.test.ts` holds that line.
 */
import { allViewPlugins } from "@/core/viewRegistry";
import type { Scape } from "@/core/types";
import { downloadScapeFile } from "@/export/scapeFile";
import type { PublishedScape } from "@/publish/contract";
import { localCopyFromPublication } from "@/shared/publicCopy";

export type ViewerExportFormat = "scape" | "pdf";

/**
 * A publication carries no timestamps and no local id, so an export needs a document built
 * around it. `localCopyFromPublication` already does exactly that — the one difference is the
 * name: a copy someone is about to edit is "X copy", a file they are filing away is "X".
 */
function documentFor(scape: PublishedScape): Scape {
  return { ...localCopyFromPublication(scape), name: scape.name || "Untitled scape" };
}

/** Resolves once the file has been handed to the browser. Throws if the render fails. */
export async function exportPublication(
  scape: PublishedScape,
  format: ViewerExportFormat,
): Promise<void> {
  const document = documentFor(scape);
  if (format === "scape") {
    downloadScapeFile(document);
    return;
  }
  // jsPDF is a large dependency and most readers never export. It loads on the click, not on
  // first paint — the same bargain the editor makes in `src/app/Editor.tsx`.
  const { exportScapePdf } = await import("@/export/pdf");
  await exportScapePdf(document, { plugins: allViewPlugins() });
}
