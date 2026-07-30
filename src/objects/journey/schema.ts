import { z } from "zod";

export const journeyStepSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  detail: z.string().optional(),
});

export const journeySchema = z.object({
  steps: z.array(journeyStepSchema),
});

export type JourneyStep = z.infer<typeof journeyStepSchema>;
export type JourneyData = z.infer<typeof journeySchema>;

/** Node body shows this many steps, then a count. Keeps a 40-step journey node-sized. */
export const VISIBLE_STEPS = 5;
