import { z } from "zod";

export const noteSchema = z.object({
  body: z.string(),
});

export type NoteData = z.infer<typeof noteSchema>;
