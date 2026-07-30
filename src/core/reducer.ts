import type { Action, ActionPayload } from "./actions";
import { newTxId } from "./ids";
import type { Relationship, Scape, ScapeObject } from "./types";

/**
 * The single mutation path.
 *
 * Pure: same Scape in, same Scape out, no side effects, no clock reads beyond `action.ts`.
 * Returns the new state alongside the action that undoes it — inverses are computed here,
 * at apply time, because that is the only moment the previous values are known.
 *
 * `inverse` is null when the action was a no-op (e.g. moving an object that does not exist).
 * The caller drops no-ops rather than pushing an undo step that does nothing.
 *
 * Note on `ScapeObject.updatedAt`: it is stamped at creation and never bumped by an edit.
 * Undo has to restore state exactly — otherwise a snapshot written after undo differs from
 * the one written before, and "undo" quietly stops meaning undo. Carrying the previous
 * timestamp through every inverse would buy per-object recency at the cost of a field on
 * half the action schemas; the append-only action log already records edit recency, and
 * derives it more accurately. Only `Scape.updatedAt` tracks the clock.
 */
export interface ApplyResult {
  state: Scape;
  inverse: Action | null;
}

export function applyAction(state: Scape, action: Action): ApplyResult {
  const result = reduce(state, action);
  if (!result.inverse) return { state, inverse: null };
  return {
    state: { ...result.state, updatedAt: action.ts },
    inverse: result.inverse,
  };
}

/** Convenience for building an inverse: same transaction, same timestamp as the forward action. */
function inv(action: Action, rest: ActionPayload): Action {
  return { ...rest, txId: action.txId, ts: action.ts } as Action;
}

function reduce(state: Scape, action: Action): ApplyResult {
  switch (action.type) {
    case "CreateObject": {
      if (state.objects[action.id]) return { state, inverse: null };
      const object: ScapeObject = {
        id: action.id,
        type: action.objectType,
        title: action.title,
        data: action.data ?? {},
        // Never from the model. The engine lays out immediately after.
        x: 0,
        y: 0,
        createdAt: action.ts,
        updatedAt: action.ts,
      };
      return {
        state: {
          ...state,
          objects: { ...state.objects, [object.id]: object },
          objectOrder: [...state.objectOrder, object.id],
        },
        inverse: inv(action, { type: "DeleteObject", id: object.id }),
      };
    }

    case "RestoreObject": {
      if (state.objects[action.object.id]) return { state, inverse: null };
      const order = [...state.objectOrder];
      order.splice(Math.min(action.index, order.length), 0, action.object.id);
      const relationships = { ...state.relationships };
      for (const rel of action.relationships) relationships[rel.id] = rel;
      return {
        state: {
          ...state,
          objects: { ...state.objects, [action.object.id]: action.object as ScapeObject },
          objectOrder: order,
          relationships,
        },
        inverse: inv(action, { type: "DeleteObject", id: action.object.id }),
      };
    }

    case "DeleteObject": {
      const existing = state.objects[action.id];
      if (!existing) return { state, inverse: null };

      const objects = { ...state.objects };
      delete objects[action.id];

      // Deleting an object drops its incident edges, so the inverse has to carry them back.
      const orphaned: Relationship[] = [];
      const relationships: Record<string, Relationship> = {};
      for (const rel of Object.values(state.relationships)) {
        if (rel.from === action.id || rel.to === action.id) orphaned.push(rel);
        else relationships[rel.id] = rel;
      }

      const index = state.objectOrder.indexOf(action.id);
      return {
        state: {
          ...state,
          objects,
          objectOrder: state.objectOrder.filter((id) => id !== action.id),
          relationships,
        },
        inverse: inv(action, {
          type: "RestoreObject",
          object: existing,
          relationships: orphaned,
          index: index < 0 ? state.objectOrder.length : index,
        }),
      };
    }

    case "UpdateObject": {
      const existing = state.objects[action.id];
      if (!existing) return { state, inverse: null };

      // The inverse patch carries exactly the keys the forward patch touched, with the
      // values they had. Patching only `title` must not clobber `data` on undo.
      const before: { title?: string; data?: Record<string, unknown> } = {};
      const next = { ...existing };
      if (action.patch.title !== undefined) {
        before.title = existing.title;
        next.title = action.patch.title;
      }
      if (action.patch.data !== undefined) {
        before.data = existing.data;
        next.data = action.patch.data;
      }
      if (Object.keys(before).length === 0) return { state, inverse: null };

      return {
        state: { ...state, objects: { ...state.objects, [action.id]: next } },
        inverse: inv(action, { type: "UpdateObject", id: action.id, patch: before }),
      };
    }

    case "MoveObject": {
      const existing = state.objects[action.id];
      if (!existing) return { state, inverse: null };
      if (existing.x === action.x && existing.y === action.y) return { state, inverse: null };
      return {
        state: {
          ...state,
          objects: {
            ...state.objects,
            [action.id]: { ...existing, x: action.x, y: action.y },
          },
        },
        inverse: inv(action, {
          type: "MoveObject",
          id: action.id,
          x: existing.x,
          y: existing.y,
        }),
      };
    }

    case "LayoutScape": {
      const before: Record<string, { x: number; y: number }> = {};
      const objects = { ...state.objects };
      let changed = false;
      for (const [id, pos] of Object.entries(action.positions)) {
        const existing = objects[id];
        if (!existing) continue;
        before[id] = { x: existing.x, y: existing.y };
        if (existing.x === pos.x && existing.y === pos.y) continue;
        objects[id] = { ...existing, x: pos.x, y: pos.y };
        changed = true;
      }
      if (!changed) return { state, inverse: null };
      return {
        state: { ...state, objects },
        inverse: inv(action, { type: "LayoutScape", positions: before }),
      };
    }

    case "DuplicateObject": {
      const source = state.objects[action.id];
      if (!source || state.objects[action.newId]) return { state, inverse: null };
      const copy: ScapeObject = {
        ...source,
        id: action.newId,
        data: structuredClone(source.data),
        x: source.x + 32,
        y: source.y + 32,
        createdAt: action.ts,
        updatedAt: action.ts,
      };
      return {
        state: {
          ...state,
          objects: { ...state.objects, [copy.id]: copy },
          objectOrder: [...state.objectOrder, copy.id],
        },
        inverse: inv(action, { type: "DeleteObject", id: copy.id }),
      };
    }

    case "ConnectObjects": {
      if (state.relationships[action.id]) return { state, inverse: null };
      // Both endpoints must exist. The model plans poorly sometimes and will reference an
      // object it has not created yet; dropping here keeps the graph consistent.
      if (!state.objects[action.from] || !state.objects[action.to]) {
        return { state, inverse: null };
      }
      if (action.from === action.to) return { state, inverse: null };

      const rel: Relationship = { id: action.id, from: action.from, to: action.to };
      if (action.label !== undefined) rel.label = action.label;
      return {
        state: { ...state, relationships: { ...state.relationships, [rel.id]: rel } },
        inverse: inv(action, { type: "DisconnectObjects", id: rel.id }),
      };
    }

    case "DisconnectObjects": {
      const existing = state.relationships[action.id];
      if (!existing) return { state, inverse: null };
      const relationships = { ...state.relationships };
      delete relationships[action.id];
      return {
        state: { ...state, relationships },
        inverse: inv(action, {
          type: "ConnectObjects",
          id: existing.id,
          from: existing.from,
          to: existing.to,
          ...(existing.label !== undefined ? { label: existing.label } : {}),
        }),
      };
    }

    case "RenameScape": {
      if (state.name === action.name) return { state, inverse: null };
      return {
        state: { ...state, name: action.name },
        inverse: inv(action, { type: "RenameScape", name: state.name }),
      };
    }

    case "SetViewState": {
      const v = state.viewState;
      const n = action.viewState;
      if (v.x === n.x && v.y === n.y && v.zoom === n.zoom) return { state, inverse: null };
      return {
        state: { ...state, viewState: n },
        inverse: inv(action, { type: "SetViewState", viewState: v }),
      };
    }
  }
}

/** Apply a whole transaction, returning the inverses in the order undo should replay them. */
export function applyTransaction(
  state: Scape,
  actions: Action[],
): { state: Scape; inverses: Action[] } {
  let next = state;
  const inverses: Action[] = [];
  for (const action of actions) {
    const result = applyAction(next, action);
    next = result.state;
    if (result.inverse) inverses.unshift(result.inverse);
  }
  return { state: next, inverses };
}

/** Stamp a set of payloads with one transaction id, so they undo as a single step. */
export function transaction(
  payloads: ActionPayload[],
  txId = newTxId(),
  ts = Date.now(),
): Action[] {
  return payloads.map((p) => ({ ...p, txId, ts }) as Action);
}
