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

export const primitiveSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(PRIMITIVE_KINDS),
  label: z.string().optional(),
  span: z.number().int().min(1).max(12),
});

export const wireframeSchema = z.object({
  primitives: z.array(primitiveSchema),
});

export type PrimitiveKind = (typeof PRIMITIVE_KINDS)[number];
export type Primitive = z.infer<typeof primitiveSchema>;
export type WireframeData = z.infer<typeof wireframeSchema>;

/** Node body renders this many, then a count — a 30-primitive wireframe stays node-sized. */
export const VISIBLE_PRIMITIVES = 10;
