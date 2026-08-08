import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyScape, fixtureScape } from "@/core/fixtures";
import { useScapeStore } from "@/core/store";
import { toPlainScape } from "@/core/serialize";
import type { Scape, ScapeRepository } from "@/core/types";
import { startAutosave } from "./autosave";
import { PrecipiceDb } from "./db";
import { MemoryScapeRepository } from "./memoryRepository";
import { DexieScapeRepository } from "./scapeRepository";
import { importScape, parseScapeFile, ScapeImportError, serializeScape } from "./portable";
import { previewOf, summarize } from "./summary";

/**
 * The same suite runs against both implementations. A contract with one implementation is
 * just that implementation's shape written down twice.
 */
function describeRepository(name: string, make: () => Promise<ScapeRepository>) {
  describe(`${name} — ScapeRepository conformance`, () => {
    let repo: ScapeRepository;
    beforeEach(async () => {
      repo = await make();
    });

    it("creates, lists and reads back a scape", async () => {
      const created = await repo.create("First");
      expect(created.name).toBe("First");

      const list = await repo.list();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: created.id, name: "First", objectCount: 0 });

      expect(await repo.get(created.id)).toMatchObject({ id: created.id, name: "First" });
    });

    it("returns undefined for a scape that does not exist", async () => {
      expect(await repo.get("nope")).toBeUndefined();
    });

    it("saves and reloads a full snapshot", async () => {
      const created = await repo.create("Snap");
      const scape: Scape = { ...fixtureScape(), id: created.id, name: "Snap" };
      await repo.saveSnapshot(scape, 1);

      const loaded = await repo.get(created.id);
      expect(loaded).toEqual(scape);
      expect((await repo.list())[0].objectCount).toBe(scape.objectOrder.length);
    });

    it("drops a stale snapshot write so out-of-order completion cannot roll state back", async () => {
      const created = await repo.create("Seq");
      const base = { ...fixtureScape(), id: created.id };

      await repo.saveSnapshot({ ...base, name: "newer" }, 5);
      // A slow write of an older snapshot completing late must not win.
      await repo.saveSnapshot({ ...base, name: "older" }, 2);

      expect((await repo.get(created.id))!.name).toBe("newer");
    });

    it("renames", async () => {
      const created = await repo.create("Before");
      await repo.rename(created.id, "After");
      expect((await repo.get(created.id))!.name).toBe("After");
    });

    it("duplicates into a new id, leaving the original alone", async () => {
      const created = await repo.create("Original");
      await repo.saveSnapshot({ ...fixtureScape(), id: created.id, name: "Original" }, 1);

      const copy = await repo.duplicate(created.id);
      expect(copy.id).not.toBe(created.id);
      expect(copy.name).toBe("Original copy");
      expect(copy.objectOrder).toEqual(fixtureScape().objectOrder);
      expect(await repo.get(created.id)).toBeDefined();
    });

    it("removes a scape and its action log", async () => {
      const created = await repo.create("Doomed");
      await repo.appendActions(created.id, [{ type: "RenameScape", name: "x", txId: "t1", ts: 1 }]);
      await repo.remove(created.id);

      expect(await repo.get(created.id)).toBeUndefined();
      expect(await repo.getActionLog(created.id)).toHaveLength(0);
    });

    it("appends to the action log in order and never rewrites it", async () => {
      const created = await repo.create("Logged");
      await repo.appendActions(created.id, [
        { type: "RenameScape", name: "one", txId: "t1", ts: 1 },
        { type: "RenameScape", name: "two", txId: "t1", ts: 2 },
      ]);
      await repo.appendActions(created.id, [
        { type: "RenameScape", name: "three", txId: "t2", ts: 3 },
      ]);

      const log = await repo.getActionLog(created.id);
      expect(log.map((entry) => (entry.action as { name: string }).name)).toEqual([
        "one",
        "two",
        "three",
      ]);
      expect(log.map((entry) => entry.txId)).toEqual(["t1", "t1", "t2"]);
    });

    it("ignores an empty append", async () => {
      const created = await repo.create("Empty");
      await repo.appendActions(created.id, []);
      expect(await repo.getActionLog(created.id)).toHaveLength(0);
    });
  });
}

describeRepository("memory", async () => new MemoryScapeRepository());

describeRepository("dexie", async () => {
  // A fresh database per test, so ordering between tests cannot matter.
  const database = new PrecipiceDb(`precipice-test-${Math.random().toString(36).slice(2)}`);
  await database.open();
  return new DexieScapeRepository(database);
});

describe("export and import", () => {
  it("round-trips: export then import deep-equals the original scape", async () => {
    const original = fixtureScape();
    const text = serializeScape(original);

    const repo = new MemoryScapeRepository();
    const imported = await importScape(text, repo);

    // Identity and timestamps are deliberately new; everything that is content must match.
    const { id: _a, createdAt: _b, updatedAt: _c, ...importedContent } = imported;
    const { id: _d, createdAt: _e, updatedAt: _f, ...originalContent } = original;
    expect(importedContent).toEqual(originalContent);
  });

  it("round-trips the action log alongside the scape", async () => {
    const original = fixtureScape();
    const log = [
      { type: "RenameScape" as const, name: "renamed", txId: "t1", ts: 10 },
      { type: "MoveObject" as const, id: "brief", x: 4, y: 5, txId: "t2", ts: 11 },
    ];
    const repo = new MemoryScapeRepository();
    const imported = await importScape(serializeScape(original, log), repo);

    const stored = await repo.getActionLog(imported.id);
    expect(stored.map((entry) => entry.action)).toEqual(log);
  });

  it("always creates a new scape rather than overwriting an existing one", async () => {
    const repo = new MemoryScapeRepository();
    const existing = await repo.create("Existing");
    await repo.saveSnapshot({ ...fixtureScape(), id: existing.id, name: "Existing" }, 1);

    const original = fixtureScape();
    const imported = await importScape(serializeScape(original), repo);

    expect(imported.id).not.toBe(existing.id);
    expect((await repo.get(existing.id))!.name).toBe("Existing");
    expect(await repo.list()).toHaveLength(2);
  });

  describe("rejects malformed files loudly, without corrupting existing data", () => {
    const cases: Array<[string, string]> = [
      ["not JSON at all", "{{{"],
      ["JSON that is not a scape file", JSON.stringify({ hello: "world" })],
      [
        "a scape missing required fields",
        JSON.stringify({ version: 1, scape: { id: "x" }, actionLog: [] }),
      ],
      [
        "an object with the wrong field types",
        JSON.stringify({
          version: 1,
          scape: { ...fixtureScape(), objectOrder: "not-an-array" },
          actionLog: [],
        }),
      ],
      [
        "an action the protocol does not define",
        JSON.stringify({
          version: 1,
          scape: fixtureScape(),
          actionLog: [{ type: "DropDatabase", txId: "t", ts: 1 }],
        }),
      ],
    ];

    for (const [label, text] of cases) {
      it(label, async () => {
        const repo = new MemoryScapeRepository();
        const existing = await repo.create("Untouched");
        await repo.saveSnapshot({ ...fixtureScape(), id: existing.id, name: "Untouched" }, 1);
        const before = await repo.get(existing.id);

        await expect(importScape(text, repo)).rejects.toBeInstanceOf(ScapeImportError);

        expect(await repo.list()).toHaveLength(1);
        expect(await repo.get(existing.id)).toEqual(before);
      });
    }
  });

  it("names a version mismatch specifically rather than saying 'invalid file'", () => {
    const text = JSON.stringify({ version: 99, scape: fixtureScape(), actionLog: [] });
    expect(() => parseScapeFile(text)).toThrow(/version 99/);
  });

  it("names the offending field when the shape is wrong", () => {
    const text = JSON.stringify({
      version: 1,
      scape: { ...fixtureScape(), viewState: { x: 0, y: 0 } },
      actionLog: [],
    });
    expect(() => parseScapeFile(text)).toThrow(/zoom/);
  });
});

describe("autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useScapeStore.getState().loadScape(emptyScape("scp_auto", "Autosaved"));
  });
  afterEach(() => vi.useRealTimers());

  it("coalesces 50 rapid mutations into exactly one snapshot write", async () => {
    const repo = new MemoryScapeRepository();
    const save = vi.spyOn(repo, "saveSnapshot");
    const autosave = startAutosave(repo);

    for (let i = 0; i < 50; i++) {
      useScapeStore
        .getState()
        .dispatchTx([{ type: "MoveObject", id: "missing", x: i, y: i }, ...[]]);
      useScapeStore
        .getState()
        .dispatchTx([{ type: "CreateObject", id: `n${i}`, objectType: "note", title: `N${i}` }]);
    }

    // Nothing written yet — the debounce has not elapsed.
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(1);
    expect(autosave.writes()).toBe(1);

    // And the single snapshot contains every one of the 50 objects.
    expect(save.mock.calls[0][0].objectOrder).toHaveLength(50);
    autosave.stop();
  });

  it("appends every action from the burst to the log, not just the last", async () => {
    const repo = new MemoryScapeRepository();
    const append = vi.spyOn(repo, "appendActions");
    const autosave = startAutosave(repo);

    for (let i = 0; i < 10; i++) {
      useScapeStore
        .getState()
        .dispatchTx([{ type: "CreateObject", id: `n${i}`, objectType: "note", title: `N${i}` }]);
    }

    await vi.advanceTimersByTimeAsync(300);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][1]).toHaveLength(10);
    autosave.stop();
  });

  it("writes immediately when the tab is hidden, rather than losing the last 300ms", async () => {
    const repo = new MemoryScapeRepository();
    const save = vi.spyOn(repo, "saveSnapshot");
    const autosave = startAutosave(repo);

    useScapeStore
      .getState()
      .dispatchTx([{ type: "CreateObject", id: "n1", objectType: "note", title: "N" }]);
    expect(save).not.toHaveBeenCalled();

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(save).toHaveBeenCalledTimes(1);
    autosave.stop();
  });

  it("stops writing once stopped", async () => {
    const repo = new MemoryScapeRepository();
    const save = vi.spyOn(repo, "saveSnapshot");
    const autosave = startAutosave(repo);
    autosave.stop();

    useScapeStore
      .getState()
      .dispatchTx([{ type: "CreateObject", id: "n1", objectType: "note", title: "N" }]);
    await vi.advanceTimersByTimeAsync(600);

    expect(save).not.toHaveBeenCalled();
  });
});

describe("scape summaries", () => {
  it("counts objects by type and reports the relationship count", () => {
    const summary = summarize(fixtureScape());
    expect(summary.objectCount).toBe(12);
    expect(summary.relationshipCount).toBe(12);
    expect(summary.typeCounts).toEqual({ note: 5, journey: 3, wireframe: 4 });
  });

  it("carries the starter through, and omits it when there is none", () => {
    expect(summarize(emptyScape("scp_a", "A", { starter: "mind-map" })).starter).toBe("mind-map");
    expect(summarize(emptyScape("scp_b", "B")).starter).toBeUndefined();
  });

  it("normalises preview positions into a unit box", () => {
    const preview = previewOf(fixtureScape())!;
    expect(preview.nodes).toHaveLength(12);
    for (const node of preview.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(1);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(1);
    }
    // Edge endpoints are indices into `nodes`, so every one must be in range.
    for (const [from, to] of preview.edges) {
      expect(preview.nodes[from]).toBeDefined();
      expect(preview.nodes[to]).toBeDefined();
    }
  });

  it("does not divide by zero when every object shares a coordinate", () => {
    const scape = emptyScape("scp_flat");
    for (const id of ["a", "b"]) {
      scape.objects[id] = {
        id,
        type: "note",
        title: id,
        data: { body: "" },
        x: 100,
        y: 100,
        createdAt: 0,
        updatedAt: 0,
      };
      scape.objectOrder.push(id);
    }
    const preview = previewOf(scape)!;
    expect(preview.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
  });

  it("has no preview at all for an empty scape", () => {
    expect(previewOf(emptyScape("scp_empty"))).toBeUndefined();
    expect(summarize(emptyScape("scp_empty")).preview).toBeUndefined();
  });
});

describe("scape meta survives the round trip", () => {
  it("keeps the starter through a snapshot write, because toPlainScape parses it", () => {
    const scape = emptyScape("scp_meta", "Meta", { starter: "mind-map" });
    expect(toPlainScape(scape).meta).toEqual({ starter: "mind-map" });
  });

  it("keeps a key written by a newer build rather than dropping it on first save", () => {
    const scape = emptyScape("scp_future", "Future", { starter: "blank", somethingNew: 7 });
    expect(toPlainScape(scape).meta).toEqual({ starter: "blank", somethingNew: 7 });
  });
});
