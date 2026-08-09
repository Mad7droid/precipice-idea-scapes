import { z } from "zod";

/**
 * The vocabulary a low-fidelity screen is drawn from.
 *
 * This started at five kinds on the theory that anything more turns a demonstration into a
 * design tool. In practice five was too few to describe a real screen without every element
 * collapsing into `box`, so the set now covers the things that actually recur: headings,
 * media, avatars, the two common form controls, and chips. Existing scapes keep working —
 * the original five are unchanged and still first.
 */
export const PRIMITIVE_KINDS = [
  "section",
  "heading",
  "text",
  "box",
  "image",
  "avatar",
  "input",
  "button",
  "checkbox",
  "toggle",
  "badge",
  "list",
  "divider",
] as const;

/** Which grid granularities a screen can be drawn on. Twelve is needless precision for a
 * simple screen, and a four-column grid makes halves and thirds land exactly. */
export const COLUMN_CHOICES = [4, 6, 12] as const;

export const DEFAULT_COLUMNS = 12;

/**
 * Every field beyond `id`/`kind`/`span` is optional, on purpose: a wireframe written before
 * any of them existed has to keep validating, and it does.
 */
export const primitiveSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(PRIMITIVE_KINDS),
  label: z.string().optional(),
  span: z.number().int().min(1).max(12),
  /** Where the element sits inside its column when it does not fill it. */
  align: z.enum(["start", "center", "end"]).optional(),
  /** Vertical weight, for the kinds that occupy area rather than a line of text. */
  size: z.enum(["sm", "md", "lg"]).optional(),
});

export const wireframeSchema = z.object({
  primitives: z.array(primitiveSchema),
  // Version 1 put card geometry here. Keep rejecting it rather than silently dropping a
  // caller mistake; import migration is the one supported compatibility path.
  width: z.never().optional(),
  columns: z.union([z.literal(4), z.literal(6), z.literal(12)]).optional(),
});

export type PrimitiveKind = (typeof PRIMITIVE_KINDS)[number];
export type Primitive = z.infer<typeof primitiveSchema>;
export type WireframeData = z.infer<typeof wireframeSchema>;

/** A section is a region header: always full width, never counted against the cutoff. */
export function isSection(primitive: Primitive): boolean {
  return primitive.kind === "section";
}

export function columnsOf(data: Partial<WireframeData>): number {
  return data.columns ?? DEFAULT_COLUMNS;
}
