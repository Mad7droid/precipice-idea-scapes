import { create } from "zustand";
import { NON_UNDOABLE_ACTIONS, type Action, type ActionPayload } from "./actions";
import { newTxId } from "./ids";
import { applyAction } from "./reducer";
import type { ObjectId, Scape, TxId } from "./types";

/**
 * Proof that a dispatch belongs to the commit currently holding the store.
 *
 * A commit has to be able to write while everything else is frozen out, so the gate cannot
 * simply reject every dispatch. It rejects every dispatch that does not carry the token
 * `commit` handed to its own callback. The token is a fresh symbol per commit and never
 * leaves that callback, so "is this write part of the transaction" is answered by identity
 * rather than by a flag anyone could set.
 */
export type CommitToken = symbol;
let activeCommit: CommitToken | null = null;

/**
 * Undo steps kept per open scape. Each step holds the values it replaced, so an unbounded stack
 * grows for as long as the scape stays open — days, in the desktop app.
 */
export const MAX_UNDO_STEPS = 200;

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
  /** True while `commit` holds the store. Read-only: there is no setter by design. */
  committing: boolean;

  loadScape: (scape: Scape | null) => void;
  /** Returns false if the action was a no-op and nothing was recorded. */
  dispatch: (action: Action, token?: CommitToken) => boolean;
  /** Stamps one txId across the payloads so they undo together. */
  dispatchTx: (payloads: ActionPayload[], txId?: TxId, token?: CommitToken) => TxId;
  /**
   * Runs `work` with the store frozen against every other mutation: user edits, undo, redo
   * and a second commit all no-op until it settles. Writes belonging to this commit pass the
   * token through to `dispatch`/`dispatchTx`.
   *
   * This is what makes an MCP batch atomic against the person typing in the same tab. The
   * flag is lowered in `finally`, so a throwing or rejecting `work` cannot wedge the editor.
   */
  commit: <T>(work: (token: CommitToken) => T | Promise<T>) => Promise<T>;
  undo: () => boolean;
  redo: () => boolean;
  setSelection: (ids: ObjectId[]) => void;
  setGenerating: (generating: boolean) => void;
  /** Removes and returns everything logged since the last drain. */
  drainActionLog: () => Action[];
}

function findLastIndex<T>(items: readonly T[], match: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (match(items[i])) return i;
  return -1;
}

export const useScapeStore = create<StoreState>((set, get) => ({
  scape: null,
  selection: [],
  actionLog: [],
  undoStack: [],
  redoStack: [],
  generating: false,
  committing: false,

  loadScape: (scape) => set({ scape, selection: [], actionLog: [], undoStack: [], redoStack: [] }),

  dispatch: (action, token) => {
    const { scape, undoStack } = get();
    if (!scape || (get().committing && token !== activeCommit)) return false;

    const { state, inverse } = applyAction(scape, action);
    if (!inverse) return false;

    // Camera moves are applied and logged, but never become an undo step.
    if (NON_UNDOABLE_ACTIONS.has(action.type)) {
      set({ scape: state, actionLog: [...get().actionLog, action] });
      return true;
    }

    // Coalesce on txId across the whole stack, not just the top. A streamed generation that
    // was interleaved with another step (a nudge, an inspector edit) must still undo as one
    // step; the merged transaction moves to the top because it is the most recent activity.
    const index = findLastIndex(undoStack, (tx) => tx.txId === action.txId);
    let nextUndo: Transaction[];
    if (index >= 0) {
      const existing = undoStack[index];
      // Prepend so replaying front-to-back reverses application order.
      nextUndo = [
        ...undoStack.slice(0, index),
        ...undoStack.slice(index + 1),
        { ...existing, inverses: [inverse, ...existing.inverses], size: existing.size + 1 },
      ];
    } else {
      nextUndo = [...undoStack, { txId: action.txId, inverses: [inverse], size: 1 }];
      if (nextUndo.length > MAX_UNDO_STEPS) nextUndo = nextUndo.slice(-MAX_UNDO_STEPS);
    }

    set({
      scape: state,
      actionLog: [...get().actionLog, action],
      undoStack: nextUndo,
      redoStack: [],
    });
    return true;
  },

  dispatchTx: (payloads, txId = newTxId(), token) => {
    const ts = Date.now();
    for (const payload of payloads) {
      get().dispatch({ ...payload, txId, ts } as Action, token);
    }
    return txId;
  },

  commit: async (work) => {
    if (get().committing) throw new Error("commit_in_progress");
    const token: CommitToken = Symbol("commit");
    activeCommit = token;
    set({ committing: true });
    try {
      return await work(token);
    } finally {
      activeCommit = null;
      set({ committing: false });
    }
  },

  undo: () => {
    const { scape, undoStack } = get();
    // Undo mid-generation would split the stream's transaction in two: the half already
    // applied would be undone and the rest would land as a fresh step. Blocked here so every
    // path (toolbar, Cmd+Z, menus) gets the same answer.
    if (get().committing || get().generating || !scape || undoStack.length === 0) return false;
    const tx = undoStack[undoStack.length - 1];

    let next = scape;
    const redoInverses: Action[] = [];
    const applied: Action[] = [];
    // Replayed now, so stamped now: Scape.updatedAt must not move backwards on undo.
    const ts = Date.now();
    for (const stored of tx.inverses) {
      const inverse = { ...stored, ts } as Action;
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
    if (get().committing || get().generating || !scape || redoStack.length === 0) return false;
    const tx = redoStack[redoStack.length - 1];

    let next = scape;
    const undoInverses: Action[] = [];
    const applied: Action[] = [];
    const ts = Date.now();
    for (const stored of tx.inverses) {
      const action = { ...stored, ts } as Action;
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
