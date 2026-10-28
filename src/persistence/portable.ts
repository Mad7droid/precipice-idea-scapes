import type { Action } from "@/core/actions";
import { newScapeId } from "@/core/ids";
import { notify } from "@/core/notify";
import { scapeFileSchema, SCAPE_FILE_VERSION, type ScapeFile } from "@/core/serialize";
import type { Scape, ScapeRepository } from "@/core/types";
import { downloadScapeFile } from "@/export/scapeFile";
import { migrateDocument } from "./migrate";
import { nextSnapshotSeq } from "./sequence";
import { repairScape, ScapeIntegrityError } from "./repair";

export { serializeScape, toScapeFile } from "@/export/scapeFile";

export function downloadScape(scape: Scape, actionLog: Action[] = []): void {
  downloadScapeFile(scape, actionLog);
  notify.success("Exported.");
}

export class ScapeImportError extends Error {}

/**
 * Parses a `.scape`, rejecting loudly and specifically. "Invalid file" is not a message a
 * person can act on, so failures name the field and what was wrong with it.
 *
 * An *older* file is migrated rather than refused. Refusing one orphans every export somebody
 * has already made, which is the opposite of what a portable format is for. A *newer* file is
 * still refused, because this build cannot know what its fields mean.
 */
export function parseScapeFile(text: string): ScapeFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ScapeImportError(NOT_A_SCAPE);
  }

  const version = (json as { version?: unknown })?.version;
  if (typeof version === "number" && version > SCAPE_FILE_VERSION) {
    throw new ScapeImportError(
      `That file is version ${version}; this build reads version ${SCAPE_FILE_VERSION}.`,
    );
  }

  // Migrate before validating: an older document is not expected to satisfy today's schema,
  // which is the whole reason the step exists.
  let candidate = json;
  if (typeof version === "number" && version < SCAPE_FILE_VERSION) {
    const file = json as { scape?: unknown };
    try {
      candidate = {
        ...file,
        version: SCAPE_FILE_VERSION,
        scape: migrateDocument((file.scape ?? {}) as Record<string, unknown>, version),
      };
    } catch (error) {
      throw new ScapeImportError(error instanceof Error ? error.message : String(error));
    }
  }

  const result = scapeFileSchema.safeParse(candidate);
  // Schema paths ("scape.objects.x.data: Required") mean nothing to the person importing.
  if (!result.success) throw new ScapeImportError(NOT_A_SCAPE);
  try {
    return { ...result.data, scape: repairScape(result.data.scape as Scape) as ScapeFile["scape"] };
  } catch (error) {
    if (error instanceof ScapeIntegrityError)
      throw new ScapeImportError(`This Precipice file is damaged. ${error.message}`);
    throw error;
  }
}

const NOT_A_SCAPE = "This isn't a Precipice file. Choose a .scape or a Precipice library backup.";

/** `"Plan"` → `"Plan (imported)"` when the library already has a "Plan"; then `(imported 2)`… */
export function importedName(name: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  if (!taken.has(name)) return name;
  let candidate = `${name} (imported)`;
  for (let n = 2; taken.has(candidate); n++) candidate = `${name} (imported ${n})`;
  return candidate;
}

/**
 * Import always creates a *new* scape rather than overwriting an existing one. An import that
 * can silently replace your work is a data-loss bug waiting to be reported.
 */
export async function importScape(text: string, repository: ScapeRepository): Promise<Scape> {
  const file = parseScapeFile(text);

  const names = (await repository.list()).map((summary) => summary.name);
  const scape: Scape = {
    ...file.scape,
    name: importedName(file.scape.name, names),
    id: newScapeId(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Rejects on a failed write, so the success below is only reported for a saved scape.
  await repository.saveSnapshot(scape, nextSnapshotSeq());
  if (file.actionLog.length) await repository.appendActions(scape.id, file.actionLog);

  const count = scape.objectOrder.length;
  notify.success("Imported.", `${count} ${count === 1 ? "object" : "objects"} in a new scape.`);
  return scape;
}
