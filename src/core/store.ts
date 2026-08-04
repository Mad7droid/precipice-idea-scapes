import { create } from "zustand";
import { NON_UNDOABLE_ACTIONS, type Action, type ActionPayload } from "./actions";
import { newTxId } from "./ids";
import { applyAction } from "./reducer";
import type { ObjectId, Scape, TxId } from "./types";

/**
 * One store, one mutation path.
 *
 * Undo groups on `txId` and nothing else. A drag emits one MoveObject with a fresh txId, so
 * it is one undo step. A whole AI generation stamps every action with the same txId, so it
 * is also one undo step. There is no separate "batch" concept to keep in sync.
 */
export interface Transaction {
  txId: TxId;
  /** Ordered so that replaying front-to-back undoes the transaction. */
  inverses: Action[];
  size: number;
}

interface StoreState {
  scape: Scape | null;
  selection: ObjectId[];
  /** Session log. Autosave drains it; the dev routes render it. */
  actionLog: Action[];
  undoStack: Transaction[];
  redoStack: Transaction[];
  /** Set while a generation is streaming, so the canvas can defer expensive work. */
  generating: boolean;

  loadScape: (scape: Scape | null) => void;
  /** Returns false if the action was a no-op and nothing was recorded. */
  dispatch: (action: Action) => boolean;
  /** Stamps one txId across the payloads so they undo together. */
  dispatchTx: (payloads: ActionPayload[], txId?: TxId) => TxId;
  undo: () => boolean;
  redo: () => boolean;
  setSelection: (ids: ObjectId[]) => void;
  setGenerating: (generating: boolean) => void;
  /** Removes and returns everything logged since the last drain. */
  drainActionLog: () => Action[];
}

export const useScapeStore = create<StoreState>((set, get) => ({
  scape: null,
  selection: [],
  actionLog: [],
  undoStack: [],
  redoStack: [],
  generating: false,

  loadScape: (scape) => set({ scape, selection: [], actionLog: [], undoStack: [], redoStack: [] }),

  dispatch: (action) => {
    const { scape, undoStack } = get();
    if (!scape) return false;

    const { state, inverse } = applyAction(scape, action);
    if (!inverse) return false;

    // Camera moves are applied and logged, but never become an undo step.
    if (NON_UNDOABLE_ACTIONS.has(action.type)) {
      set({ scape: state, actionLog: [...get().actionLog, action] });
      return true;
    }

    const top = undoStack[undoStack.length - 1];
    let nextUndo: Transaction[];
    if (top && top.txId === action.txId) {
      // Same transaction: prepend so replaying front-to-back reverses application order.
      nextUndo = [
        ...undoStack.slice(0, -1),
        { ...top, inverses: [inverse, ...top.inverses], size: top.size + 1 },
      ];
    } else {
      nextUndo = [...undoStack, { txId: action.txId, inverses: [inverse], size: 1 }];
    }

    set({
      scape: state,
      actionLog: [...get().actionLog, action],
      undoStack: nextUndo,
      redoStack: [],
    });
    return true;
  },

  dispatchTx: (payloads, txId = newTxId()) => {
    const ts = Date.now();
    for (const payload of payloads) {
      get().dispatch({ ...payload, txId, ts } as Action);
    }
    return txId;
  },

  undo: () => {
    const { scape, undoStack } = get();
    if (!scape || undoStack.length === 0) return false;
    const tx = undoStack[undoStack.length - 1];

    let next = scape;
    const redoInverses: Action[] = [];
    const applied: Action[] = [];
    for (const inverse of tx.inverses) {
      const result = applyAction(next, inverse);
      if (!result.inverse) continue;
      next = result.state;
      applied.push(inverse);
      redoInverses.unshift(result.inverse);
    }

    set({
      scape: next,
      actionLog: [...get().actionLog, ...applied],
      undoStack: undoStack.slice(0, -1),
      redoStack: [...get().redoStack, { txId: tx.txId, inverses: redoInverses, size: tx.size }],
    });
    return applied.length > 0;
  },

  redo: () => {
    const { scape, redoStack } = get();
    if (!scape || redoStack.length === 0) return false;
    const tx = redoStack[redoStack.length - 1];

    let next = scape;
    const undoInverses: Action[] = [];
    const applied: Action[] = [];
    for (const action of tx.inverses) {
      const result = applyAction(next, action);
      if (!result.inverse) continue;
      next = result.state;
      applied.push(action);
      undoInverses.unshift(result.inverse);
    }

    set({
      scape: next,
      actionLog: [...get().actionLog, ...applied],
      redoStack: redoStack.slice(0, -1),
      undoStack: [...get().undoStack, { txId: tx.txId, inverses: undoInverses, size: tx.size }],
    });
    return applied.length > 0;
  },

  setSelection: (ids) => set({ selection: ids }),
  setGenerating: (generating) => set({ generating }),

  drainActionLog: () => {
    const log = get().actionLog;
    if (log.length === 0) return [];
    set({ actionLog: [] });
    return log;
  },
}));

/** Non-hook access, for modules that dispatch outside React (autosave, the AI apply loop). */
export const scapeStore = useScapeStore;
