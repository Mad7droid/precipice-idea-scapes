import { z } from "zod";
import { newScapeId } from "@/core/ids";
import { toPlainScape } from "@/core/serialize";
import { toScapeFile } from "@/export/scapeFile";
import { downloadBlob } from "@/export/download";
import { db, type PrecipiceDb } from "./db";
import { CURRENT_DOC_VERSION, migrateScape } from "./migrate";
import { importedName, parseScapeFile, ScapeImportError } from "./portable";

const envelope = z.object({
  format: z.literal("precipice-library"),
  version: z.literal(1),
  scapes: z.array(z.unknown()).min(1).max(1000),
});
export const MAX_LIBRARY_BYTES = 100 * 1024 * 1024;

export interface LibraryExport {
  text: string;
  exported: number;
  /** Names of scapes this build cannot read (written by a newer version); left out of the file. */
  skipped: string[];
}

/**
 * Read a consistent snapshot of every document. No settings, auth, publication tables or
 * action logs: a backup restores documents as new copies, and history is per-device detail
 * that would multiply the file size and carry edits the person may have deliberately undone.
 *
 * Reads the tables directly rather than through `ScapeRepository` because it needs one
 * read transaction across every row; the repository has no consistent bulk read.
 */
export async function exportLibrary(database: PrecipiceDb = db): Promise<LibraryExport> {
  return database.transaction("r", database.scapes, async () => {
    const rows = await database.scapes.toArray();
    if (!rows.length) throw new Error("There are no scapes to export.");
    if (rows.length > 1000)
      throw new Error("Export individual scapes for libraries larger than 1,000 scapes.");
    const scapes = [];
    const skipped: string[] = [];
    for (const row of rows) {
      try {
        scapes.push(
          toScapeFile(
            migrateScape(row.snapshot as unknown as Record<string, unknown>, row.version),
          ),
        );
      } catch {
        skipped.push(row.name);
      }
    }
    if (!scapes.length) throw new Error("None of these scapes can be read by this version.");
    const text = JSON.stringify({ format: "precipice-library", version: 1, scapes });
    if (new Blob([text]).size > MAX_LIBRARY_BYTES)
      throw new Error("This library is larger than 100 MB. Export individual scapes instead.");
    return { text, exported: scapes.length, skipped };
  });
}

export async function downloadLibrary(): Promise<Omit<LibraryExport, "text">> {
  const { text, ...result } = await exportLibrary();
  // Use a standard extension so macOS's native picker enables the file without
  // requiring a custom UTI registration in every installed copy of the app.
  downloadBlob(new Blob([text], { type: "application/json" }), "Precipice-library.json");
  return result;
}

/**
 * Validate every document first; commit all new copies or none. Never overwrite an existing ID.
 *
 * Writes the tables directly rather than through `ScapeRepository`: all-or-nothing needs one
 * transaction across every copy, and the repository writes one scape per transaction. Rows
 * use the same shape and `toPlainScape` serialisation as `DexieScapeRepository.write`.
 */
export async function importLibrary(text: string, database: PrecipiceDb = db): Promise<number> {
  if (new Blob([text]).size > MAX_LIBRARY_BYTES)
    throw new ScapeImportError("Library files must be smaller than 100 MB.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ScapeImportError("That library is not valid JSON.");
  }
  const parsed = envelope.safeParse(json);
  if (!parsed.success)
    throw new ScapeImportError("Expected a version 1 Precipice library with 1–1,000 scapes.");
  const files = parsed.data.scapes.map((file) => parseScapeFile(JSON.stringify(file)));
  await database.transaction("rw", database.scapes, database.actions, async () => {
    const names = new Set((await database.scapes.toArray()).map((row) => row.name));
    for (const file of files) {
      const name = importedName(file.scape.name, names);
      names.add(name);
      const snapshot = toPlainScape({ ...file.scape, name, id: newScapeId() });
      await database.scapes.add({
        id: snapshot.id,
        name: snapshot.name,
        updatedAt: snapshot.updatedAt,
        objectCount: snapshot.objectOrder.length,
        snapshot,
        version: CURRENT_DOC_VERSION,
      });
      if (file.actionLog.length)
        await database.actions.bulkAdd(
          file.actionLog.map((action) => ({
            scapeId: snapshot.id,
            ts: action.ts,
            txId: action.txId,
            action,
          })),
        );
    }
  });
  return files.length;
}
