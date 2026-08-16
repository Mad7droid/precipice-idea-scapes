/**
 * Writing a `.scape` out.
 *
 * Separate from `@/persistence/portable`, which also *reads* them: reading needs migration,
 * a repository to import into, and the toast channel. Writing needs none of that, and the
 * public viewer — which may not reach `src/persistence` at all — exports the same file from
 * the same code as the editor. See `src/viewer/bundle.test.ts`.
 */
import type { Action } from "@/core/actions";
import { SCAPE_FILE_VERSION, toPlainScape, type ScapeFile } from "@/core/serialize";
import type { Scape } from "@/core/types";
import { downloadBlob, filenameFor } from "./download";

/** A `.scape` is plain JSON, indented, readable in a text editor on purpose. */
export function toScapeFile(scape: Scape, actionLog: Action[] = []): ScapeFile {
  return { version: SCAPE_FILE_VERSION, scape: toPlainScape(scape), actionLog };
}

export function serializeScape(scape: Scape, actionLog: Action[] = []): string {
  return JSON.stringify(toScapeFile(scape, actionLog), null, 2);
}

/** Hands the file to the browser. Says nothing to the user; the caller owns the confirmation. */
export function downloadScapeFile(scape: Scape, actionLog: Action[] = []): void {
  const blob = new Blob([serializeScape(scape, actionLog)], { type: "application/json" });
  downloadBlob(blob, `${filenameFor(scape.name)}.scape`);
}
