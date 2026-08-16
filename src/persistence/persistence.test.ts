import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notify } from "@/core/notify";
import { emptyScape, fixtureScape } from "@/core/fixtures";
import { useScapeStore } from "@/core/store";
import { toPlainScape } from "@/core/serialize";
import type { Action } from "@/core/actions";
import type { PublicationRecord, Scape, ScapeRepository } from "@/core/types";
import { startAutosave } from "./autosave";
import { PrecipiceDb } from "./db";
import { CURRENT_DOC_VERSION } from "./migrate";
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

    describe("publications", () => {
      const record = (scapeId: string, overrides = {}): PublicationRecord => ({
        scapeId,
        publicationId: "pub_abcdefghijklmnopqrstuvwxyz",
        publishedHash: "a".repeat(64),
        version: 1,
        status: "published",
        updatedAt: 1_000,
        ...overrides,
      });

      it("round-trips a row and reports none for an unpublished scape", async () => {
        const created = await repo.create("Public");
        expect(await repo.publications.get(created.id)).toBeUndefined();

        await repo.publications.put(record(created.id));
        expect(await repo.publications.get(created.id)).toMatchObject({
          publicationId: "pub_abcdefghijklmnopqrstuvwxyz",
          status: "published",
        });
      });

      it("keeps one row per scape — a republish overwrites rather than accumulates", async () => {
        const created = await repo.create("Republished");
        await repo.publications.put(record(created.id));
        await repo.publications.put(record(created.id, { version: 2, updatedAt: 2_000 }));

        expect(await repo.publications.all()).toHaveLength(1);
        expect((await repo.publications.get(created.id))!.version).toBe(2);
      });

      it("does not copy the row to a duplicate — one publication belongs to one scape", async () => {
        const created = await repo.create("Original");
        await repo.publications.put(record(created.id));

        const copy = await repo.duplicate(created.id);

        expect(await repo.publications.get(copy.id)).toBeUndefined();
        // And the original keeps its own.
        expect(await repo.publications.get(created.id)).toBeDefined();
      });

      it("removes the row with the scape, so nothing is orphaned", async () => {
        const created = await repo.create("Doomed");
        await repo.publications.put(record(created.id));

        await repo.remove(created.id);

        expect(await repo.publications.get(created.id)).toBeUndefined();
        expect(await repo.publications.all()).toHaveLength(0);
      });

      it("leaves other scapes' rows alone when one is removed", async () => {
        const kept = await repo.create("Kept");
        const doomed = await repo.create("Doomed");
        await repo.publications.put(record(kept.id));
        await repo.publications.put(record(doomed.id));

        await repo.remove(doomed.id);

        expect(await repo.publications.all()).toHaveLength(1);
        expect(await repo.publications.get(kept.id)).toBeDefined();
      });
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

  it("opens a v1 export and promotes its wireframe card width", () => {
    const legacy = fixtureScape();
    const wireframe = legacy.objects["wf-welcome"]!;
    legacy.objects[wireframe.id] = {
      ...wireframe,
      data: { ...wireframe.data, width: 520 },
    };

    const parsed = parseScapeFile(JSON.stringify({ version: 1, scape: legacy, actionLog: [] }));

    expect(parsed.version).toBe(CURRENT_DOC_VERSION);
    expect(parsed.scape.objects[wireframe.id]).toMatchObject({ width: 520 });
    expect(parsed.scape.objects[wireframe.id]!.data).not.toHaveProperty("width");
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

describe("Dexie repository — stored document versions", () => {
  it("opens a row written before snapshots carried a version", async () => {
    const database = new PrecipiceDb(`v-${Math.random()}`);
    const repo = new DexieScapeRepository(database);
    const scape = fixtureScape();

    // Exactly what an older build wrote: no `version` column at all.
    await database.scapes.put({
      id: scape.id,
      name: scape.name,
      updatedAt: scape.updatedAt,
      objectCount: scape.objectOrder.length,
      snapshot: toPlainScape(scape),
    });

    const loaded = await repo.get(scape.id);
    expect(loaded?.objectOrder).toEqual(scape.objectOrder);
    expect(await repo.list()).toHaveLength(1);
  });

  it("stamps the current version on everything it writes", async () => {
    const database = new PrecipiceDb(`v-${Math.random()}`);
    const repo = new DexieScapeRepository(database);
    const created = await repo.create("Versioned");

    expect((await database.scapes.get(created.id))?.version).toBe(CURRENT_DOC_VERSION);
  });

  it("skips a scape from a newer build instead of failing the whole library", async () => {
    const error = vi.spyOn(notify, "error").mockImplementation(() => 0);
    const database = new PrecipiceDb(`v-${Math.random()}`);
    const repo = new DexieScapeRepository(database);
    const readable = await repo.create("Readable");

    const scape = fixtureScape();
    await database.scapes.put({
      id: scape.id,
      name: "From the future",
      updatedAt: Date.now(),
      objectCount: 0,
      snapshot: toPlainScape(scape),
      version: CURRENT_DOC_VERSION + 1,
    });

    const list = await repo.list();
    expect(list.map((s) => s.id)).toEqual([readable.id]);
    expect(error).toHaveBeenCalled();
    // Left on disk untouched, so a later build can still read it.
    expect(await database.scapes.get(scape.id)).toBeDefined();
    error.mockRestore();
  });
});

describe("action log growth", () => {
  const logAction = (i: number): Action => ({
    type: "CreateObject",
    id: `n${i}`,
    objectType: "note",
    title: `N${i}`,
    txId: `tx_${i}`,
    ts: 1_700_000_000_000 + i,
  });

  it("keeps the newest entries and drops the oldest once the log outgrows its cap", async () => {
    const database = new PrecipiceDb(`log-${Math.random()}`);
    // Production caps at 5000 and measures every 200; the policy is what is under test, not
    // the constants.
    const repo = new DexieScapeRepository(database, { maxLoggedActions: 10, trimCheckEvery: 4 });
    const scape = await repo.create("Chatty");

    for (let i = 0; i < 40; i++) await repo.appendActions(scape.id, [logAction(i)]);

    const log = await repo.getActionLog(scape.id);
    expect(log).toHaveLength(10);
    expect(log.map((entry) => entry.txId)).toEqual(
      Array.from({ length: 10 }, (_, i) => `tx_${30 + i}`),
    );
  });

  it("does not trim a log that is within its cap", async () => {
    const database = new PrecipiceDb(`log-${Math.random()}`);
    const repo = new DexieScapeRepository(database, { maxLoggedActions: 10, trimCheckEvery: 1 });
    const scape = await repo.create("Quiet");

    for (let i = 0; i < 8; i++) await repo.appendActions(scape.id, [logAction(i)]);

    expect(await repo.getActionLog(scape.id)).toHaveLength(8);
  });

  it("trims one scape's history without touching another's", async () => {
    const database = new PrecipiceDb(`log-${Math.random()}`);
    const repo = new DexieScapeRepository(database, { maxLoggedActions: 5, trimCheckEvery: 2 });
    const loud = await repo.create("Loud");
    const quiet = await repo.create("Quiet");

    for (let i = 0; i < 20; i++) await repo.appendActions(loud.id, [logAction(i)]);
    await repo.appendActions(quiet.id, [logAction(99)]);

    expect(await repo.getActionLog(loud.id)).toHaveLength(5);
    expect(await repo.getActionLog(quiet.id)).toHaveLength(1);
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

  it("flushes on stop, so leaving the editor mid-debounce does not lose the last edit", async () => {
    const repo = new MemoryScapeRepository();
    const save = vi.spyOn(repo, "saveSnapshot");
    const autosave = startAutosave(repo);

    useScapeStore
      .getState()
      .dispatchTx([{ type: "CreateObject", id: "n1", objectType: "note", title: "N" }]);
    expect(save).not.toHaveBeenCalled();

    autosave.stop();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].objects["n1"]).toBeDefined();
  });

  /**
   * A snapshot is the whole document. A follower tab that wrote one would replace the holding
   * tab's work with its own stale copy — the data loss the lease exists to prevent.
   */
  it("writes nothing while another tab holds the lease", async () => {
    const repo = new MemoryScapeRepository();
    const save = vi.spyOn(repo, "saveSnapshot");
    const append = vi.spyOn(repo, "appendActions");
    let holder = false;
    const autosave = startAutosave(repo, { canWrite: () => holder });

    useScapeStore
      .getState()
      .dispatchTx([{ type: "CreateObject", id: "n1", objectType: "note", title: "N" }]);
    await vi.advanceTimersByTimeAsync(300);

    expect(save).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    // Drained rather than queued: a follower pans and zooms, and those actions would otherwise
    // pile up in memory for as long as the tab stays open.
    expect(useScapeStore.getState().actionLog).toHaveLength(0);

    holder = true;
    useScapeStore
      .getState()
      .dispatchTx([{ type: "CreateObject", id: "n2", objectType: "note", title: "N2" }]);
    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(1);

    autosave.stop();
  });
});

describe("scape summaries", () => {
  it("counts objects by type and reports the relationship count", () => {
    const summary = summarize(fixtureScape());
    expect(summary.objectCount).toBe(13);
    expect(summary.relationshipCount).toBe(13);
    expect(summary.typeCounts).toEqual({ note: 5, journey: 3, wireframe: 4, scape: 1 });
  });

  it("carries the starter through, and omits it when there is none", () => {
    expect(summarize(emptyScape("scp_a", "A", { starter: "mind-map" })).starter).toBe("mind-map");
    expect(summarize(emptyScape("scp_b", "B")).starter).toBeUndefined();
  });

  it("normalises preview positions into a unit box", () => {
    const preview = previewOf(fixtureScape())!;
    expect(preview.nodes).toHaveLength(13);
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
