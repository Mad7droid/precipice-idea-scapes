import { describe, expect, it } from "vitest";
import { fixtureScape } from "@/core/fixtures";
import { CURRENT_DOC_VERSION, DocumentTooNewError, migrateDocument, STEPS } from "./migrate";

/**
 * The first shipped migration promotes legacy wireframe card widths out of plugin data. The
 * independent steps below also exercise a multi-version chain, so a later migration has a
 * direct proof that it composes with the first one.
 */
const steps = {
  1: (document: Record<string, unknown>) => ({ ...document, addedInV2: true }),
  2: (document: Record<string, unknown>) => ({ ...document, addedInV3: true }),
};

describe("document migration", () => {
  it("runs every step between the document's version and the build's, in order", () => {
    const applied: number[] = [];
    const result = migrateDocument({ name: "old" }, 1, {
      target: 3,
      steps: {
        1: (d) => {
          applied.push(1);
          return { ...d, one: true };
        },
        2: (d) => {
          applied.push(2);
          return { ...d, two: true };
        },
      },
    });

    expect(applied).toEqual([1, 2]);
    expect(result).toEqual({ name: "old", one: true, two: true });
  });

  it("treats a document with no version as version 1", () => {
    // Snapshots written before versioning existed carry no version. They are the first shape
    // by definition, and guessing anything else would run the wrong steps over them.
    expect(migrateDocument({ name: "old" }, undefined, { target: 2, steps })).toMatchObject({
      addedInV2: true,
    });
  });

  it("leaves a current document exactly as it is", () => {
    const scape = fixtureScape();
    const document = scape as unknown as Record<string, unknown>;
    expect(migrateDocument(document, CURRENT_DOC_VERSION)).toBe(document);
  });

  it("promotes the v1 wireframe card width without touching its content", () => {
    const document = {
      objects: {
        wireframe: {
          id: "wireframe",
          type: "wireframe",
          data: { width: 520, columns: 6, primitives: [] },
        },
        note: {
          id: "note",
          type: "note",
          // `width` is potentially meaningful note content in a future plugin; only the v1
          // wireframe schema used it as card geometry.
          data: { width: 520, body: "Keep me" },
        },
      },
    };

    expect(migrateDocument(document, 1)).toEqual({
      objects: {
        wireframe: {
          id: "wireframe",
          type: "wireframe",
          width: 520,
          data: { columns: 6, primitives: [] },
        },
        note: {
          id: "note",
          type: "note",
          data: { width: 520, body: "Keep me" },
        },
      },
    });
  });

  it("refuses a document from a newer build rather than guessing at its fields", () => {
    expect(() => migrateDocument({}, 9, { target: 2, steps })).toThrow(DocumentTooNewError);
    expect(() => migrateDocument({}, 9, { target: 2, steps })).toThrow(/version 9/);
  });

  it("fails loudly when a version was bumped without a step to read the old shape", () => {
    expect(() => migrateDocument({}, 1, { target: 3, steps: { 1: (d) => d } })).toThrow(
      /No migration from scape version 2 to 3/,
    );
  });

  it("ships no steps below the current version", () => {
    // Guards the release checklist: bumping CURRENT_DOC_VERSION without adding a step would
    // make every stored scape unreadable, and this fails before that reaches anyone.
    for (let v = 1; v < CURRENT_DOC_VERSION; v++) {
      expect(STEPS[v], `missing migration from version ${v}`).toBeTypeOf("function");
    }
  });
});
