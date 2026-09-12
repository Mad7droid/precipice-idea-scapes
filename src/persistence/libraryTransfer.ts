import { z } from "zod";
import { newScapeId } from "@/core/ids";
import { toPlainScape } from "@/core/serialize";
import { toScapeFile } from "@/export/scapeFile";
import { downloadBlob } from "@/export/download";
import { db, type PrecipiceDb } from "./db";
import { CURRENT_DOC_VERSION, migrateScape } from "./migrate";
import { parseScapeFile, ScapeImportError } from "./portable";

const envelope = z.object({
  format: z.literal("precipice-library"),
  version: z.literal(1),
  scapes: z.array(z.unknown()).min(1).max(1000),
});
export const MAX_LIBRARY_BYTES = 100 * 1024 * 1024;

/** Read a consistent snapshot of every document. No settings, auth or publication tables. */
export async function exportLibrary(database: PrecipiceDb = db): Promise<string> {
  return database.transaction("r", database.scapes, database.actions, async () => {
    const rows = await database.scapes.toArray();
    if (!rows.length) throw new Error("There are no scapes to export.");
    if (rows.length > 1000)
      throw new Error("Export individual scapes for libraries larger than 1,000 scapes.");
    const actions = await database.actions.toArray();
    const scapes = rows.map((row) =>
      toScapeFile(
        migrateScape(row.snapshot as unknown as Record<string, unknown>, row.version),
        actions.filter((a) => a.scapeId === row.id).map((a) => a.action),
      ),
    );
    const text = JSON.stringify({ format: "precipice-library", version: 1, scapes });
    if (new Blob([text]).size > MAX_LIBRARY_BYTES)
      throw new Error("This library is larger than 100 MB. Export individual scapes instead.");
    return text;
  });
}

export async function downloadLibrary(): Promise<void> {
  const text = await exportLibrary();
  // Use a standard extension so macOS's native picker enables the file without
  // requiring a custom UTI registration in every installed copy of the app.
  downloadBlob(new Blob([text], { type: "application/json" }), "Precipice-library.json");
}

/** Validate every document first; commit all new copies or none. Never overwrite an existing ID. */
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
    for (const file of files) {
      const snapshot = toPlainScape({ ...file.scape, id: newScapeId() });
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
