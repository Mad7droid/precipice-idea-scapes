import { z } from "zod";
import type { Action } from "@/core/actions";
import { newScapeId } from "@/core/ids";
import { notify } from "@/core/notify";
import {
  describeParseError,
  scapeFileSchema,
  SCAPE_FILE_VERSION,
  type ScapeFile,
} from "@/core/serialize";
import type { Scape, ScapeRepository } from "@/core/types";
import { downloadScapeFile } from "@/export/scapeFile";
import { migrateDocument } from "./migrate";

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
    throw new ScapeImportError("That file is not valid JSON.");
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
  if (!result.success) {
    throw new ScapeImportError(describeParseError(result.error as z.ZodError));
  }
  return result.data;
}

/**
 * Import always creates a *new* scape rather than overwriting an existing one. An import that
 * can silently replace your work is a data-loss bug waiting to be reported.
 */
export async function importScape(text: string, repository: ScapeRepository): Promise<Scape> {
  const file = parseScapeFile(text);

  const scape: Scape = {
    ...file.scape,
    id: newScapeId(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await repository.saveSnapshot(scape, Date.now());
  if (file.actionLog.length) await repository.appendActions(scape.id, file.actionLog);

  notify.success("Imported.", `${scape.objectOrder.length} objects in a new scape.`);
  return scape;
}
