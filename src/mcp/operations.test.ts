import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyScape } from "@/core/fixtures";
import type { Action, ActionPayload } from "@/core/actions";
import { PrecipiceDb } from "@/persistence/db";
import type { McpOperation } from "./contracts";
import { applyBatch } from "./document";
import { saveOperation } from "./operations";

let db: PrecipiceDb;
let counter = 0;

beforeEach(async () => {
  db = new PrecipiceDb(`precipice-mcp-${counter++}`);
  await db.open();
});

const receipt = (over: Partial<McpOperation> = {}): McpOperation => ({
  key: "key_1",
  scapeId: "scp_1",
  command: { id: "cmd_1", tool: "apply_changes", args: {} },
  fingerprint: "fp",
  expiresAt: Date.now() + 60_000,
  result: { status: "applied" },
  ...over,
});

describe("saveOperation", () => {
  it("commits the snapshot, the action log and the receipt together", async () => {
    const scape = emptyScape("scp_1");
    const { state, actions } = applyBatch(
      scape,
      [
        { type: "CreateObject", id: "a", objectType: "note", title: "A", data: { body: "" } },
      ] as ActionPayload[],
      "tx_mcp",
    );

    await saveOperation(receipt({ afterRevision: "rev_2" }), state, actions, db);

    expect((await db.scapes.get("scp_1"))?.objectCount).toBe(1);
    expect(await db.actions.where({ scapeId: "scp_1" }).count()).toBe(1);
    expect((await db.mcpOperations.get("key_1"))?.afterRevision).toBe("rev_2");
  });

  it("stores a receipt on its own, so a rejected command is still deduplicated", async () => {
    await saveOperation(receipt({ result: { status: "rejected" } }), undefined, [], db);

    expect(await db.scapes.count()).toBe(0);
    expect((await db.mcpOperations.get("key_1"))?.result.status).toBe("rejected");
  });

  it("writes nothing at all when the tab has lost the write lease", async () => {
    const scape = emptyScape("scp_1");
    await expect(saveOperation(receipt(), scape, [], db, () => false)).rejects.toThrow(/read_only/);

    expect(await db.scapes.count()).toBe(0);
    expect(await db.mcpOperations.count()).toBe(0);
  });

  it("rolls the snapshot back if the lease is lost midway, rather than half-committing", async () => {
    const scape = emptyScape("scp_1");
    let calls = 0;
    // Holder on entry, gone by the final check — the race the second guard exists to catch.
    const canWrite = () => ++calls < 2;

    await expect(saveOperation(receipt(), scape, [], db, canWrite)).rejects.toThrow(/read_only/);

    expect(await db.scapes.count()).toBe(0);
    expect(await db.mcpOperations.count()).toBe(0);
  });

  it("replaying the same key overwrites its own receipt instead of adding a second", async () => {
    await saveOperation(receipt(), undefined, [], db);
    await saveOperation(
      receipt({ result: { status: "applied", revision: "rev_3" } }),
      undefined,
      [],
      db,
    );

    expect(await db.mcpOperations.count()).toBe(1);
    expect((await db.mcpOperations.get("key_1"))?.result.revision).toBe("rev_3");
  });

  it("keeps each scape's action log separate", async () => {
    const first = emptyScape("scp_1");
    const second = emptyScape("scp_2");
    const stamp = (scapeId: string): Action[] => [
      { type: "RenameScape", name: scapeId, txId: `tx_${scapeId}`, ts: 1 } as Action,
    ];

    await saveOperation(receipt({ key: "k1" }), first, stamp("scp_1"), db);
    await saveOperation(receipt({ key: "k2", scapeId: "scp_2" }), second, stamp("scp_2"), db);

    expect(await db.actions.where({ scapeId: "scp_1" }).count()).toBe(1);
    expect(await db.actions.where({ scapeId: "scp_2" }).count()).toBe(1);
  });
});
