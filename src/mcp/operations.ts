import type { Action } from "../core/actions";
import type { Scape } from "../core/types";
import type { McpOperation } from "./contracts";
import { db, type PrecipiceDb } from "../persistence/db";
import { CURRENT_DOC_VERSION } from "../persistence/migrate";
import { toPlainScape } from "../core/serialize";

/**
 * Snapshot, action history and deduplication receipt commit together, or not at all.
 *
 * Deliberately not routed through `ScapeRepository`: the receipt table is MCP-only, and the
 * idempotency guarantee depends on the snapshot and its receipt sharing one IndexedDB
 * transaction with the lease re-checked inside it. The repository writes one table per call
 * and cannot join that transaction. The row shape and `toPlainScape` serialisation mirror
 * `DexieScapeRepository.write`; keep the two in step.
 */
export async function saveOperation(
  operation: McpOperation,
  scape?: Scape,
  actions: Action[] = [],
  database: PrecipiceDb = db,
  canWrite: () => boolean = () => true,
) {
  await database.transaction(
    "rw",
    database.scapes,
    database.actions,
    database.mcpOperations,
    async () => {
      if (!canWrite()) throw new Error("read_only");
      if (scape) {
        const snapshot = toPlainScape(scape);
        await database.scapes.put({
          id: scape.id,
          name: scape.name,
          updatedAt: scape.updatedAt,
          objectCount: scape.objectOrder.length,
          snapshot,
          version: CURRENT_DOC_VERSION,
        });
        if (actions.length)
          await database.actions.bulkAdd(
            actions.map((action) => ({
              scapeId: scape.id,
              txId: action.txId,
              ts: action.ts,
              action,
            })),
          );
      }
      await database.mcpOperations.put(operation);
      if (!canWrite()) throw new Error("read_only");
    },
  );
}

/** How long a receipt outlives its expiry, so recent history and revert keep working. */
export const RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60_000;

/**
 * Receipts are written by every agent command and were never removed, so the table grew for
 * as long as agents were used. Long-expired ones go; a preview that is still publicly shared
 * stays, because its row is what lets the person withdraw it.
 */
export async function pruneOperations(database: PrecipiceDb = db, now = Date.now()) {
  await database.mcpOperations
    .where("expiresAt")
    .below(now - RECEIPT_RETENTION_MS)
    .filter((operation) => !operation.command.args.__share)
    .delete();
}
