import { z } from "zod";
import { actionSchema } from "./actions";
import type { Scape } from "./types";

/**
 * Version 2 moves the card width from plugin-owned `data.width` to the shared object field.
 * Older files are upgraded by `persistence/migrate.ts` before this schema sees them.
 */
export const SCAPE_FILE_VERSION = 2;

const relationship = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
});

const scapeObject = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  title: z.string(),
  data: z.record(z.string(), z.unknown()),
  x: z.number(),
  y: z.number(),
  width: z.number().min(200).max(900).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const scapeSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  objects: z.record(z.string(), scapeObject),
  objectOrder: z.array(z.string()),
  relationships: z.record(z.string(), relationship),
  viewState: z.object({ x: z.number(), y: z.number(), zoom: z.number() }),
  /**
   * Open-ended and optional. `toPlainScape` parses through this schema before anything is
   * written to disk, so a key that is not declared here is silently dropped — which is why
   * `meta` is a permissive record rather than a closed object. A scape written by a newer
   * build carries its settings through this one intact instead of losing them on first save.
   */
  meta: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/** The `.scape` file. Plain JSON, no compression, readable in a text editor on purpose. */
export const scapeFileSchema = z.object({
  version: z.literal(SCAPE_FILE_VERSION),
  scape: scapeSchema,
  actionLog: z.array(actionSchema),
});

export type ScapeFile = z.infer<typeof scapeFileSchema>;

/**
 * Serializes through the schema rather than JSON.stringify on the store, so a stray
 * non-serializable field can never reach disk.
 */
export function toPlainScape(scape: Scape): Scape {
  return scapeSchema.parse(scape) as Scape;
}

/**
 * Turns a Zod failure into copy a human can act on: which field, and what was wrong with it.
 * Import must reject loudly and specifically — "invalid file" is not a message.
 */
export function describeParseError(error: z.ZodError): string {
  const issues = error.issues.slice(0, 3).map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "the file root";
    return `${path}: ${issue.message.toLowerCase()}`;
  });
  const more = error.issues.length > 3 ? ` (+${error.issues.length - 3} more)` : "";
  return issues.join("; ") + more;
}
