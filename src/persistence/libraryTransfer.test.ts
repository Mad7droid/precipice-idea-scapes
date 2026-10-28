import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { fixtureScape } from "@/core/fixtures";
import { toScapeFile } from "@/export/scapeFile";
import { PrecipiceDb } from "./db";
import { CURRENT_DOC_VERSION } from "./migrate";
import { exportLibrary, importLibrary } from "./libraryTransfer";
let db: PrecipiceDb;
beforeEach(() => {
  db = new PrecipiceDb(`transfer-${crypto.randomUUID()}`);
});
afterEach(async () => {
  await db.delete();
});
const file = () => toScapeFile(fixtureScape());
const library = (scapes: unknown[]) =>
  JSON.stringify({ format: "precipice-library", version: 1, scapes });
describe("library transfer", () => {
  it("copies documents with new IDs, preserves content, and excludes all credential/settings data", async () => {
    const snapshot = fixtureScape();
    await db.scapes.add({
      id: snapshot.id,
      name: snapshot.name,
      updatedAt: snapshot.updatedAt,
      objectCount: snapshot.objectOrder.length,
      snapshot,
      version: CURRENT_DOC_VERSION,
    });
    await db.settings.add({ key: "private-test-setting", value: "do-not-export" });
    await db.actions.add({
      scapeId: snapshot.id,
      ts: 1,
      txId: "tx",
      action: { secret: "log" } as never,
    });
    const { text } = await exportLibrary(db);
    expect(text).not.toContain("do-not-export");
    expect(JSON.parse(text).scapes[0].actionLog).toEqual([]);
    expect(await importLibrary(text, db)).toBe(1);
    const rows = await db.scapes.toArray();
    expect(rows).toHaveLength(2);
    const copy = rows.find((row) => row.id !== snapshot.id)!;
    expect(copy.snapshot).toEqual({
      ...snapshot,
      id: copy.id,
      name: `${snapshot.name} (imported)`,
    });
    expect(await db.settings.count()).toBe(1);
    expect(await db.publications.count()).toBe(0);
  });
  it("skips scapes this build cannot read and names them", async () => {
    const snapshot = fixtureScape();
    const row = { name: "x", updatedAt: 1, objectCount: 0, snapshot };
    await db.scapes.add({ ...row, id: snapshot.id, version: CURRENT_DOC_VERSION });
    await db.scapes.add({ ...row, id: "scp_future", name: "Future", version: 999 });
    const result = await exportLibrary(db);
    expect(result.exported).toBe(1);
    expect(result.skipped).toEqual(["Future"]);
  });
  it("repairs object order and rejects duplicate object ids", async () => {
    const good = file();
    const first = good.scape.objectOrder[0]!;
    good.scape.objectOrder = [first, first, "missing", ...good.scape.objectOrder];
    expect(await importLibrary(library([good]), db)).toBe(1);
    const [row] = await db.scapes.toArray();
    expect(new Set(row!.snapshot.objectOrder).size).toBe(row!.snapshot.objectOrder.length);
    expect(row!.snapshot.objectOrder).not.toContain("missing");
    const bad = file();
    const [a, b] = Object.keys(bad.scape.objects);
    bad.scape.objects[b!] = { ...bad.scape.objects[b!]!, id: a! };
    await expect(importLibrary(library([bad]), db)).rejects.toThrow("damaged");
  });
  it("rejects one invalid document before importing any document", async () => {
    await expect(importLibrary(library([file(), { version: 999 }]), db)).rejects.toThrow();
    expect(await db.scapes.count()).toBe(0);
  });
  it("rolls back the entire library when a later write fails", async () => {
    const original = db.scapes.add.bind(db.scapes);
    let writes = 0;
    vi.spyOn(db.scapes, "add").mockImplementation((...args) => {
      if (++writes === 2) throw new Error("quota");
      return original(...args);
    });
    await expect(importLibrary(library([file(), file()]), db)).rejects.toThrow("quota");
    expect(await db.scapes.count()).toBe(0);
  });
  it("rejects empty and newer library formats", async () => {
    await expect(importLibrary(library([]), db)).rejects.toThrow();
    await expect(
      importLibrary(
        JSON.stringify({ format: "precipice-library", version: 2, scapes: [file()] }),
        db,
      ),
    ).rejects.toThrow();
  });
});
