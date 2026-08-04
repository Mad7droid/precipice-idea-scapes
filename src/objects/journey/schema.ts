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
