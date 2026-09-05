import type { Action } from "../core/actions";
import type { Scape } from "../core/types";
import type { Command, Outcome } from "./contracts";
import { db, type PrecipiceDb } from "../persistence/db";
import { CURRENT_DOC_VERSION } from "../persistence/migrate";
import { toPlainScape } from "../core/serialize";

export interface McpOperation {
  key: string; scapeId: string; command: Command; fingerprint: string; expiresAt: number;
  result: Outcome; inverses?: Action[]; afterRevision?: string;
}
/** Snapshot, action history and deduplication receipt commit together, or not at all. */
export async function saveOperation(operation: McpOperation, scape?: Scape, actions: Action[] = [], database: PrecipiceDb = db, canWrite: () => boolean = () => true) {
  await database.transaction("rw", database.scapes, database.actions, database.mcpOperations, async () => {
    if (!canWrite()) throw new Error("read_only");
    if (scape) {
      const snapshot = toPlainScape(scape);
      await database.scapes.put({ id: scape.id, name: scape.name, updatedAt: scape.updatedAt, objectCount: scape.objectOrder.length, snapshot, version: CURRENT_DOC_VERSION });
      if (actions.length) await database.actions.bulkAdd(actions.map(action => ({ scapeId: scape.id, txId: action.txId, ts: action.ts, action })));
    }
    await database.mcpOperations.put(operation);
    if (!canWrite()) throw new Error("read_only");
  });
}
