import { z } from "zod";

/**
 * Deliberately tiny. This is a demonstration that structured, editable, AI-generated visual
 * artifacts work — not a design tool. Adding a sixth primitive is how it stops being either.
 */
export const PRIMITIVE_KINDS = ["box", "text", "input", "button", "list"] as const;

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
