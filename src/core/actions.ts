import { z } from "zod";

/**
 * The Action Protocol.
 *
 * Every state change in Precipice is one of these. `applyAction` in reducer.ts is the only
 * thing that consumes them, and it is the only thing that mutates a Scape.
 *
 * Two rules encoded here rather than merely documented:
 *
 * 1. `CreateObject` has no `x` / `y`. The model cannot supply coordinates because the schema
 *    has nowhere to put them. Layout is the engine's job.
 * 2. `LayoutScape` and `RestoreObject` exist so that a re-layout and an undo-of-delete are
 *    each a single action — one entry in the log, one step of undo. They are constructed by
 *    the engine only and are never exposed as AI tools (see src/ai/tools.ts).
 *
 * This module deliberately imports nothing but Zod: the reducer must stay pure and cheap to
 * test, with no React and no plugin registry in its dependency graph.
 */

export const viewStateSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number(),
});

export const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const relationshipSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
});

export const scapeObjectSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  title: z.string(),
  data: z.record(z.string(), z.unknown()),
  x: z.number(),
  y: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/** Carried by every action. `txId` is what undo groups on. */
const envelope = {
  txId: z.string().min(1),
  ts: z.number(),
};

// --- Model-facing actions -------------------------------------------------------------

export const createObjectSchema = z.object({
  ...envelope,
  type: z.literal("CreateObject"),
  id: z.string().min(1),
  objectType: z.string().min(1),
  title: z.string(),
  /** Plugin-owned shape. Validated against the plugin schema at the AI boundary, not here. */
  data: z.record(z.string(), z.unknown()).optional(),
});

export const updateObjectSchema = z.object({
  ...envelope,
  type: z.literal("UpdateObject"),
  id: z.string().min(1),
  patch: z.object({
    title: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const deleteObjectSchema = z.object({
  ...envelope,
  type: z.literal("DeleteObject"),
  id: z.string().min(1),
});

export const connectObjectsSchema = z.object({
  ...envelope,
  type: z.literal("ConnectObjects"),
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
});

export const disconnectObjectsSchema = z.object({
  ...envelope,
  type: z.literal("DisconnectObjects"),
  id: z.string().min(1),
});

export const renameScapeSchema = z.object({
  ...envelope,
  type: z.literal("RenameScape"),
  name: z.string().min(1),
});

// --- Engine-only actions --------------------------------------------------------------

export const moveObjectSchema = z.object({
  ...envelope,
  type: z.literal("MoveObject"),
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
});

export const duplicateObjectSchema = z.object({
  ...envelope,
  type: z.literal("DuplicateObject"),
  id: z.string().min(1),
  newId: z.string().min(1),
});

export const setViewStateSchema = z.object({
  ...envelope,
  type: z.literal("SetViewState"),
  viewState: viewStateSchema,
});

/**
 * One action for a whole re-layout, so a layout is one undo. Positions are always computed
 * by Dagre in src/canvas/layout.ts; nothing else ever constructs this.
 */
export const layoutScapeSchema = z.object({
  ...envelope,
  type: z.literal("LayoutScape"),
  positions: z.record(z.string(), positionSchema),
});

/**
 * The inverse of DeleteObject. Deleting an object also drops its incident relationships, so
 * undoing it has to put both back — hence a dedicated action rather than a CreateObject.
 */
export const restoreObjectSchema = z.object({
  ...envelope,
  type: z.literal("RestoreObject"),
  object: scapeObjectSchema,
  relationships: z.array(relationshipSchema),
  /** Position in objectOrder, so undo puts the object back where it was. */
  index: z.number().int().min(0),
});

export const actionSchema = z.discriminatedUnion("type", [
  createObjectSchema,
  updateObjectSchema,
  deleteObjectSchema,
  connectObjectsSchema,
  disconnectObjectsSchema,
  renameScapeSchema,
  moveObjectSchema,
  duplicateObjectSchema,
  setViewStateSchema,
  layoutScapeSchema,
  restoreObjectSchema,
]);

export type Action = z.infer<typeof actionSchema>;
export type ActionType = Action["type"];

/**
 * `Omit<Action, "txId" | "ts">` collapses a union to its shared keys, which erases every
 * variant's payload. Distributing over the union first keeps each variant intact.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An action minus the envelope. Callers build these; the store stamps txId and ts. */
export type ActionPayload = DistributiveOmit<Action, "txId" | "ts">;

export type CreateObjectAction = z.infer<typeof createObjectSchema>;
export type UpdateObjectAction = z.infer<typeof updateObjectSchema>;
export type DeleteObjectAction = z.infer<typeof deleteObjectSchema>;
export type ConnectObjectsAction = z.infer<typeof connectObjectsSchema>;
export type DisconnectObjectsAction = z.infer<typeof disconnectObjectsSchema>;
export type MoveObjectAction = z.infer<typeof moveObjectSchema>;
export type LayoutScapeAction = z.infer<typeof layoutScapeSchema>;

/**
 * The subset the model is allowed to emit. Anything outside this set is engine-only, which
 * is how "AI never emits coordinates" is enforced rather than merely asked for.
 */
export const AI_ACTION_TYPES = [
  "CreateObject",
  "UpdateObject",
  "DeleteObject",
  "ConnectObjects",
  "DisconnectObjects",
  "RenameScape",
] as const satisfies readonly ActionType[];

export type AiActionType = (typeof AI_ACTION_TYPES)[number];

/** One-line summary for the generation ribbon and the action log. */
export function describeAction(action: Action): string {
  switch (action.type) {
    case "CreateObject":
      return `${action.objectType} · "${action.title}"`;
    case "UpdateObject":
      return `${action.id} · ${Object.keys(action.patch).join(", ")}`;
    case "DeleteObject":
      return action.id;
    case "ConnectObjects":
      return `${action.from} → ${action.to}${action.label ? ` · "${action.label}"` : ""}`;
    case "DisconnectObjects":
      return action.id;
    case "RenameScape":
      return `"${action.name}"`;
    case "MoveObject":
      return `${action.id} · ${Math.round(action.x)},${Math.round(action.y)}`;
    case "DuplicateObject":
      return `${action.id} → ${action.newId}`;
    case "SetViewState":
      return `zoom ${action.viewState.zoom.toFixed(2)}`;
    case "LayoutScape":
      return `${Object.keys(action.positions).length} nodes`;
    case "RestoreObject":
      return `${action.object.id} · ${action.relationships.length} edges`;
  }
}
