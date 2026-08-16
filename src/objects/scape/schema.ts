import { z } from "zod";

/**
 * Deliberately the same shape as a note's: one Markdown string. The difference between the two
 * types is the vocabulary they render and how they are edited, not what they store — which is
 * what makes converting one into the other a data copy rather than a migration.
 */
export const scapeBlockSchema = z.object({
  body: z.string(),
});

export type ScapeBlockData = z.infer<typeof scapeBlockSchema>;
