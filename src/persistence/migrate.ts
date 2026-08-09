import { SCAPE_FILE_VERSION } from "@/core/serialize";
import type { Scape } from "@/core/types";

/**
 * Upgrading documents written by older builds.
 *
 * The risk here is not Dexie's schema — that stores one snapshot blob per scape and its shape
 * has not changed. It is the shape of the `Scape` *inside* the blob, and of the `.scape` files
 * people have already exported. Both are the same problem, so both come through this module.
 *
 * The rule: a build reads every document version at or below its own, and refuses ones above
 * it. Refusing an older file is the failure mode that orphans somebody's export; refusing a
 * newer one is honest, because this build genuinely cannot know what the fields mean.
 *
 * ## Adding a migration
 *
 * 1. Bump `CURRENT_DOC_VERSION`.
 * 2. Add a step to `STEPS` keyed by the version it upgrades *from*.
 * 3. Add a fixture of the old shape to the suite. Do not edit an existing fixture — the point
 *    of the test is that yesterday's bytes still open.
 *
 * Steps take and return a plain object rather than a `Scape`, because a document one version
 * old is by definition not a `Scape` any more.
 */

/**
 * Deliberately the same number as the `.scape` file version, not a second one to keep in
 * step. A stored snapshot and an exported file hold the same document in the same shape; two
 * counters for one shape is a bug that only shows up once they disagree.
 */
export const CURRENT_DOC_VERSION = SCAPE_FILE_VERSION;

export type MigrationStep = (document: Record<string, unknown>) => Record<string, unknown>;

/** Keyed by the version each step upgrades from; applied in ascending order. */
export type MigrationSteps = Record<number, MigrationStep>;

/**
 * Version 1 stored the resizable card width inside wireframe plugin data. Card geometry belongs
 * to every object, so version 2 promotes it to `ScapeObject.width`. Keep the migration narrow:
 * a future plugin is free to use a `width` datum for its own meaning, but wireframe v1 is the
 * only shipped schema where that key meant card width.
 */
export const STEPS: MigrationSteps = {
  1: (document) => {
    const objects = document.objects;
    if (!objects || typeof objects !== "object" || Array.isArray(objects)) return document;

    const upgraded = Object.fromEntries(
      Object.entries(objects as Record<string, unknown>).map(([id, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [id, value];
        const object = value as Record<string, unknown>;
        if (object.type !== "wireframe") return [id, object];

        const data = object.data;
        if (!data || typeof data !== "object" || Array.isArray(data)) return [id, object];
        const legacyWidth = (data as Record<string, unknown>).width;
        // Values written by v1 were 200–900. Do not invent a width from malformed hand-edited
        // exports; the normal default is safer than turning bad input into saved geometry.
        const { width: _legacyWidth, ...restData } = data as Record<string, unknown>;
        if (
          typeof legacyWidth !== "number" ||
          !Number.isFinite(legacyWidth) ||
          legacyWidth < 200 ||
          legacyWidth > 900
        ) {
          return [id, { ...object, data: restData }];
        }

        return [id, { ...object, width: legacyWidth, data: restData }];
      }),
    );
    return { ...document, objects: upgraded };
  },
};

export class DocumentTooNewError extends Error {
  constructor(
    readonly found: number,
    readonly supported: number,
  ) {
    super(`That scape is version ${found}; this build reads version ${supported}.`);
  }
}

/**
 * Runs a document up to the current version.
 *
 * `from` is the version the document was written at. An absent version means 1: snapshots
 * written before versioning existed are, by definition, the first shape.
 */
export function migrateDocument(
  document: Record<string, unknown>,
  from: number | undefined,
  { steps = STEPS, target = CURRENT_DOC_VERSION }: { steps?: MigrationSteps; target?: number } = {},
): Record<string, unknown> {
  const version = from ?? 1;
  if (version > target) throw new DocumentTooNewError(version, target);

  let current = document;
  for (let v = version; v < target; v++) {
    const step = steps[v];
    if (!step) {
      // A gap in the table means a version was bumped without a way to read the old shape.
      // Better to say so than to hand back a document with fields the app will misread.
      throw new Error(`No migration from scape version ${v} to ${v + 1}.`);
    }
    current = step(current);
  }
  return current;
}

/** Convenience for the read paths, which know they are dealing with a Scape at the end. */
export function migrateScape(
  document: Record<string, unknown>,
  from: number | undefined,
  options?: { steps?: MigrationSteps; target?: number },
): Scape {
  return migrateDocument(document, from, options) as unknown as Scape;
}
