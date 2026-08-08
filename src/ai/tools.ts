import { z } from "zod";
import {
  connectObjectsSchema,
  createObjectSchema,
  deleteObjectSchema,
  disconnectObjectsSchema,
  renameScapeSchema,
  updateObjectSchema,
  type AiActionType,
} from "@/core/actions";
import { pluginTypes } from "@/core/registry";

/**
 * One tool per action type, with parameters taken straight off the Zod schemas in
 * core/actions.ts. Nothing is redefined here — a schema that drifted from the reducer's
 * would produce actions the reducer silently drops, which is the worst kind of bug to find.
 *
 * The envelope (`txId`, `ts`) and the discriminant (`type`) are stripped: the tool name
 * carries the type, and the engine stamps the transaction.
 *
 * There is deliberately no layout tool and no MoveObject tool. `CreateObject` has no x/y in
 * its schema, so the model has nowhere to put a coordinate even if it wants to.
 */
const envelope = { txId: true, ts: true, type: true } as const;

export const toolInputSchemas = {
  CreateObject: createObjectSchema.omit(envelope),
  UpdateObject: updateObjectSchema.omit(envelope),
  DeleteObject: deleteObjectSchema.omit(envelope),
  ConnectObjects: connectObjectsSchema.omit(envelope),
  DisconnectObjects: disconnectObjectsSchema.omit(envelope),
  RenameScape: renameScapeSchema.omit(envelope),
} satisfies Record<AiActionType, z.ZodTypeAny>;

export type ToolName = keyof typeof toolInputSchemas;

export const TOOL_NAMES = Object.keys(toolInputSchemas) as ToolName[];

/**
 * The tools a generation that only rewires the graph is allowed to touch.
 *
 * Restricting the tool set rather than asking the model nicely is the difference between a
 * feature and a suggestion: "suggest connections" cannot quietly invent six new notes if
 * `CreateObject` was never offered to it.
 */
export const CONNECT_TOOL_NAMES: ToolName[] = ["ConnectObjects", "DisconnectObjects"];

export function isToolName(name: string): name is ToolName {
  return name in toolInputSchemas;
}

/** Descriptions are the model's only guidance on when to reach for each one. */
export function toolDescriptions(): Record<ToolName, string> {
  const types = pluginTypes().join(", ");
  return {
    CreateObject:
      `Add an object to the scape. Choose objectType from: ${types}. ` +
      "Pick a short, readable, kebab-case id — it is shown to the user on the card. " +
      "Do not include coordinates; the engine lays the canvas out.",
    UpdateObject:
      "Change the title or data of an object that already exists. Send only the fields you " +
      "are changing.",
    DeleteObject: "Remove an object and every relationship attached to it.",
    ConnectObjects:
      "Draw a directed relationship between two objects that already exist. Create both " +
      "endpoints before connecting them. The optional label is two or three words at most.",
    DisconnectObjects: "Remove one relationship by its id.",
    RenameScape: "Rename the whole scape. Use this once, early, when the scape is untitled.",
  };
}
