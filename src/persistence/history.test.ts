import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyScape } from "@/core/fixtures";
import { applyAction } from "@/core/reducer";
import { useScapeStore } from "@/core/store";
import type { Action } from "@/core/actions";
import { changesBetween, contentKey } from "@/history/model";
import { startAutosave } from "./autosave";
import { saveOperation } from "@/mcp/operations";
import { PrecipiceDb } from "./db";
import { DexieScapeRepository } from "./scapeRepository";
import { MemoryScapeRepository } from "./memoryRepository";
import type { Scape, ScapeRepository } from "@/core/types";

const databases: PrecipiceDb[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  useScapeStore.getState().setHistoryPreview(false);
  for (const db of databases.splice(0)) await db.delete();
});
function persistent() {
  const db = new PrecipiceDb(`history-${crypto.randomUUID()}`);
  databases.push(db);
  return { db, repo: new DexieScapeRepository(db) };
}
function restoreAction(scape: Scape): Action {
  const { name, objects, objectOrder, relationships, meta, instructions } = scape;
  return {
    type: "RestoreScapeContent",
    txId: "restore",
    ts: Date.now(),
    content: { name, objects, objectOrder, relationships, meta, instructions },
  };
}
for (const [name, make] of [
  ["IndexedDB", () => persistent().repo],
  ["memory", () => new MemoryScapeRepository()],
] as const) {
  describe(`${name} history`, () => {
    it("recovers a previous version and the replaced head after a restore", async () => {
      const repo: ScapeRepository = make();
      const first = await repo.create("First concept");
      const original = (await repo.history.list(first.id))[0];
      const edited = {
        ...first,
        name: "Developed concept",
        instructions: { body: "New guidance", version: 8 },
        viewState: { x: 30, y: 40, zoom: 0.8 },
      };
      await repo.saveSnapshot(edited, 1);
      const action = restoreAction(first),
        after = applyAction(edited, action).state;
      await repo.history.restore(edited, after, original.id, () => true, action);
      expect((await repo.get(first.id))?.name).toBe("First concept");
      expect((await repo.get(first.id))?.viewState).toEqual(edited.viewState);
      const versions = await repo.history.list(first.id);
      expect(versions[0].reason).toBe("restore");
      const safety = versions.find((v) => v.reason === "before-restore")!;
      expect((await repo.history.get(safety.id))?.snapshot.name).toBe("Developed concept");
      expect((await repo.getActionLog(first.id)).at(-1)?.action.type).toBe("RestoreScapeContent");
    });
    it("deduplicates camera-only changes and rejects stale-head restoration", async () => {
      const repo = make(),
        scape = await repo.create("Start");
      const original = (await repo.history.list(scape.id))[0];
      const camera = { ...scape, viewState: { x: 90, y: 20, zoom: 2 }, updatedAt: 99 };
      await repo.saveSnapshot(camera, 1);
      await repo.history.capture(camera);
      expect(await repo.history.list(scape.id)).toHaveLength(1);
      await repo.saveSnapshot({ ...camera, name: "Another edit" }, 2);
      const action = restoreAction(scape);
      await expect(
        repo.history.restore(
          camera,
          applyAction(camera, action).state,
          original.id,
          () => true,
          action,
        ),
      ).rejects.toThrow(/changed/);
      expect((await repo.get(scape.id))?.name).toBe("Another edit");
    });
    it("protects named versions during retention and deletes history with its scape", async () => {
      const repo = make(),
        scape = await repo.create("Original");
      await repo.history.capture(scape, "manual", "Milestone");
      const named = (await repo.history.list(scape.id))[0];
      for (let i = 0; i < 205; i++) {
        const next = { ...scape, name: `Edit ${i}` };
        await repo.saveSnapshot(next, i + 1);
        await repo.history.capture(next, "manual");
      }
      expect((await repo.history.list(scape.id)).length).toBeLessThanOrEqual(200);
      expect((await repo.history.get(named.id))?.label).toBe("Milestone");
      const copy = await repo.duplicate(scape.id);
      expect((await repo.history.list(copy.id)).every((r) => r.scapeId === copy.id)).toBe(true);
      await repo.remove(scape.id);
      expect(await repo.history.list(scape.id)).toEqual([]);
    });
    it("rejects a restore without the lease and preserves current content", async () => {
      const repo = make(),
        scape = await repo.create("Original");
      const original = (await repo.history.list(scape.id))[0];
      const edited = { ...scape, name: "Latest" };
      await repo.saveSnapshot(edited, 1);
      const action = restoreAction(scape);
      await expect(
        repo.history.restore(
          edited,
          applyAction(edited, action).state,
          original.id,
          () => false,
          action,
        ),
      ).rejects.toThrow();
      expect((await repo.get(scape.id))?.name).toBe("Latest");
    });
  });
}

it("rolls back a restore if its final checkpoint cannot be saved", async () => {
  const { db, repo } = persistent(),
    scape = await repo.create("Original");
  const original = (await repo.history.list(scape.id))[0];
  const edited = { ...scape, name: "Latest" };
  await repo.saveSnapshot(edited, 1);
  const count = await db.checkpoints.count();
  const add = db.checkpoints.add.bind(db.checkpoints);
  vi.spyOn(db.checkpoints, "add").mockImplementation((row) => {
    if (row.reason === "restore") throw new Error("Quota exceeded");
    return add(row);
  });
  const action = restoreAction(scape);
  await expect(
    repo.history.restore(
      edited,
      applyAction(edited, action).state,
      original.id,
      () => true,
      action,
    ),
  ).rejects.toThrow("Quota exceeded");
  expect((await repo.get(scape.id))?.name).toBe("Latest");
  expect(await db.checkpoints.count()).toBe(count);
  expect(await repo.getActionLog(scape.id)).toEqual([]);
});

it("preserves legacy data when upgrading from schema 3 and starts history at the first write", async () => {
  const name = `legacy-history-${crypto.randomUUID()}`,
    scape = emptyScape("legacy", "Legacy");
  const old = new Dexie(name);
  old.version(3).stores({
    scapes: "id, updatedAt",
    actions: "++id, scapeId, ts, txId",
    settings: "key",
    publications: "scapeId, publicationId, status",
    mcpOperations: "key, scapeId, expiresAt",
  });
  await old.table("scapes").put({
    id: scape.id,
    snapshot: scape,
    name: scape.name,
    updatedAt: 1,
    objectCount: 0,
    version: 3,
  });
  await old.table("mcpOperations").put({ key: "receipt", scapeId: scape.id });
  old.close();
  const db = new PrecipiceDb(name);
  databases.push(db);
  const repo = new DexieScapeRepository(db);
  await repo.saveSnapshot({ ...scape, name: "Edited legacy" }, 1);
  const rows = await repo.history.list(scape.id);
  expect((await repo.history.get(rows.at(-1)!.id))?.snapshot.name).toBe("Legacy");
  expect(await db.mcpOperations.get("receipt")).toBeTruthy();
});

it("does not overwrite the head with an out-of-order autosave", async () => {
  const { repo } = persistent(),
    scape = await repo.create("Start");
  await Promise.all([
    repo.saveSnapshot({ ...scape, name: "Newest" }, 10),
    repo.saveSnapshot({ ...scape, name: "Stale" }, 9),
  ]);
  expect((await repo.get(scape.id))?.name).toBe("Newest");
});

it("rejects future checkpoint formats without modifying their stored payload", async () => {
  const { repo, db } = persistent(),
    scape = await repo.create();
  const row = (await repo.history.list(scape.id))[0];
  await db.checkpoints.update(row.id, { documentVersion: 999 });
  await expect(repo.history.get(row.id)).rejects.toThrow();
  expect((await db.checkpoints.get(row.id))?.documentVersion).toBe(999);
});

it("isolates previews from every store mutation and makes restoration one undo step", async () => {
  const scape = emptyScape("s", "Current");
  useScapeStore.getState().loadScape(scape);
  useScapeStore.getState().dispatchTx([{ type: "RenameScape", name: "Latest" }]);
  const before = useScapeStore.getState().scape!;
  useScapeStore.getState().setHistoryPreview(true);
  useScapeStore.getState().dispatchTx([{ type: "RenameScape", name: "Accidental" }]);
  expect(useScapeStore.getState().undo()).toBe(false);
  expect(useScapeStore.getState().scape).toBe(before);
  await useScapeStore
    .getState()
    .commit((token) => useScapeStore.getState().dispatch(restoreAction(scape), token));
  useScapeStore.getState().setHistoryPreview(false);
  expect(useScapeStore.getState().scape?.name).toBe("Current");
  useScapeStore.getState().undo();
  expect(useScapeStore.getState().scape?.name).toBe("Latest");
});

it("ignores bookkeeping in comparisons and detects geometry alongside content", () => {
  const scape = emptyScape("s", "Start");
  const withNote = applyAction(scape, {
    type: "CreateObject",
    id: "n",
    objectType: "note",
    title: "Note",
    data: { body: "Before" },
    ts: 1,
    txId: "t",
  }).state;
  const after = structuredClone(withNote);
  after.objects.n.x = 50;
  after.objects.n.width = 400;
  after.objects.n.data.body = "After";
  expect(changesBetween(withNote, after).map((c) => c.kind)).toEqual([
    "Edited",
    "Resized",
    "Moved",
  ]);
  expect(contentKey({ ...withNote, updatedAt: 900, viewState: { x: 1, y: 2, zoom: 3 } })).toBe(
    contentKey(withNote),
  );
});

it("captures the final edit after an idle pause even when the initial save was throttled", async () => {
  vi.useFakeTimers();
  const repo = new MemoryScapeRepository(),
    scape = await repo.create("Start");
  useScapeStore.getState().loadScape(scape);
  const autosave = startAutosave(repo);
  try {
    useScapeStore.getState().dispatchTx([{ type: "RenameScape", name: "Final edit" }]);
    await autosave.flush();
    expect(await repo.history.list(scape.id)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    const latest = (await repo.history.list(scape.id))[0];
    expect((await repo.history.get(latest.id))?.snapshot.name).toBe("Final edit");
  } finally {
    autosave.stop();
  }
});

it("retries a failed explicit flush without requiring another edit", async () => {
  const repo = new MemoryScapeRepository(),
    scape = await repo.create("Start");
  useScapeStore.getState().loadScape(scape);
  vi.spyOn(repo, "saveSnapshot").mockRejectedValueOnce(new Error("Disk unavailable"));
  const autosave = startAutosave(repo);
  try {
    useScapeStore.getState().dispatchTx([{ type: "RenameScape", name: "Keep these words" }]);
    await expect(autosave.flush()).rejects.toThrow("Disk unavailable");
    await autosave.flush();
    expect((await repo.get(scape.id))?.name).toBe("Keep these words");
  } finally {
    autosave.stop();
  }
});

it("keeps ordinary autosave working if a history write exhausts storage", async () => {
  const { repo, db } = persistent(),
    scape = await repo.create("Start");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 31_000);
  vi.spyOn(db.checkpoints, "add").mockImplementation(() => {
    throw new Error("History quota exceeded");
  });
  await expect(repo.saveSnapshot({ ...scape, name: "Latest work" }, 1)).resolves.toBeUndefined();
  expect((await repo.get(scape.id))?.name).toBe("Latest work");
  expect(await repo.history.list(scape.id)).toHaveLength(1);
});

it("rolls back all restore writes when the lease is lost during commit", async () => {
  const { repo } = persistent(),
    scape = await repo.create("Start");
  const original = (await repo.history.list(scape.id))[0];
  const edited = { ...scape, name: "Latest" };
  await repo.saveSnapshot(edited, 1);
  const action = restoreAction(scape);
  let checks = 0;
  await expect(
    repo.history.restore(
      edited,
      applyAction(edited, action).state,
      original.id,
      () => ++checks === 1,
      action,
    ),
  ).rejects.toThrow(/lease/);
  expect((await repo.get(scape.id))?.name).toBe("Latest");
  expect((await repo.history.list(scape.id)).some((r) => r.reason === "restore")).toBe(false);
});

it("preserves agent before/after snapshots atomically with its receipt", async () => {
  const { repo, db } = persistent(),
    scape = await repo.create("Before agent");
  await saveOperation(
    {
      key: "agent-history",
      scapeId: scape.id,
      command: { id: "c", tool: "apply_changes", args: {} },
      fingerprint: "fp",
      expiresAt: Date.now() + 1000,
      result: { status: "applied" },
    },
    { ...scape, name: "After agent" },
    [],
    db,
  );
  const rows = await repo.history.list(scape.id);
  expect((await repo.history.get(rows[0].id))?.snapshot.name).toBe("After agent");
  expect(rows[0].reason).toBe("agent");
  expect((await repo.history.get(rows.at(-1)!.id))?.snapshot.name).toBe("Before agent");
  expect(await db.mcpOperations.get("agent-history")).toBeTruthy();
});

it("advances instruction counters when restoring and undoing without moving the camera", () => {
  const before = {
    ...emptyScape("s", "Current"),
    instructions: { body: "Current rules", version: 10 },
  };
  const historical = { ...before, instructions: { body: "Older rules", version: 2 } };
  const restored = applyAction(before, restoreAction(historical));
  expect(restored.state.instructions).toEqual({ body: "Older rules", version: 11 });
  const undone = applyAction(restored.state, restored.inverse!);
  expect(undone.state.instructions).toEqual({ body: "Current rules", version: 12 });
  expect(undone.state.viewState).toEqual(before.viewState);
});
