import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrecipiceDb } from "./db";
import {
  WorkspaceRepository,
  WORKSPACE_KEYS,
  MAX_CAPTURE_LENGTH,
  captureAsScape,
} from "./workspace";
import { exportLibrary, importLibrary } from "./libraryTransfer";
import { parseScapeFile } from "./portable";

let db: PrecipiceDb;
let repository: WorkspaceRepository;
beforeEach(() => {
  db = new PrecipiceDb(`workspace-${crypto.randomUUID()}`);
  repository = new WorkspaceRepository(db);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
  localStorage.clear();
});

describe("local capture and promotion", () => {
  it("saves concurrent captures independently, validates bounds, and supports reversible archive", async () => {
    const [a, b] = await Promise.all([
      repository.capture("First thought"),
      repository.capture("Second thought"),
    ]);
    expect(a.id).not.toBe(b.id);
    expect(await repository.listCaptures()).toHaveLength(2);
    await repository.updateCapture(a.id, { text: "Revised thought", archived: true });
    expect((await repository.listCaptures()).find((n) => n.id === a.id)).toMatchObject({
      text: "Revised thought",
      archived: true,
    });
    await repository.updateCapture(a.id, { archived: false });
    expect((await repository.listCaptures()).find((n) => n.id === a.id)?.archived).toBe(false);
    await expect(repository.capture(" ")).rejects.toThrow();
    await expect(repository.capture("x".repeat(MAX_CAPTURE_LENGTH + 1))).rejects.toThrow();
    expect(await repository.listCaptures()).toHaveLength(2);
  });

  it("promotes through reducer actions and retries without duplicating or discarding source", async () => {
    const source = await repository.capture("Decision\nKeep manual creation available.");
    const first = await repository.promote(source.id);
    expect(await repository.promote(source.id)).toEqual(first);
    const row = await db.scapes.get(first.scapeId);
    expect(row?.snapshot.objectOrder).toEqual([first.objectId]);
    expect(row?.snapshot.objects[first.objectId].data.body).toBe(source.text);
    expect(await db.actions.count()).toBe(2);
    expect((await repository.listCaptures())[0]).toMatchObject({
      text: source.text,
      archived: true,
      promotedTo: first.scapeId,
    });
    await expect(repository.updateCapture(source.id, { text: "different" })).rejects.toThrow(
      "Edit the note there",
    );
  });

  it("rolls back the destination and receipt together if source archival fails", async () => {
    const source = await repository.capture("Recoverable thought");
    vi.spyOn(db.settings, "put").mockRejectedValueOnce(new Error("quota"));
    await expect(repository.promote(source.id)).rejects.toThrow("quota");
    expect(await db.scapes.count()).toBe(0);
    expect(await db.actions.count()).toBe(0);
    expect((await repository.listCaptures())[0]).toMatchObject({
      archived: false,
      text: source.text,
    });
  });

  it("does not create an absent requested destination", async () => {
    const source = await repository.capture("Still in Inbox");
    await expect(repository.promote(source.id, "scp_missing")).rejects.toThrow(
      "no longer available",
    );
    expect(await db.scapes.count()).toBe(0);
    expect((await repository.listCaptures())[0].archived).toBe(false);
  });

  it("restores the archived original when its promoted destination is deleted", async () => {
    const source = await repository.capture("Recover this original after deletion.");
    const target = await repository.promote(source.id);
    await db.scapes.delete(target.scapeId);
    await repository.updateCapture(source.id, { archived: false });
    expect((await repository.listCaptures())[0]).toMatchObject({
      text: source.text,
      archived: false,
    });
    expect((await repository.listCaptures())[0].promotedTo).toBeUndefined();
    const restored = await repository.promote(source.id);
    expect(
      (await db.scapes.get(restored.scapeId))?.snapshot.objects[restored.objectId].data.body,
    ).toBe(source.text);
  });

  it("exports an Inbox-only library in the existing readable format and imports new capture IDs", async () => {
    const source = await repository.capture("<script>untrusted text stays text</script>");
    await db.settings.put({ key: "anthropic.key", value: "must-not-export" });
    const result = await exportLibrary(db);
    expect(result.exported).toBe(1);
    expect(result.text).not.toContain("must-not-export");
    const file = JSON.parse(result.text).scapes[0];
    expect(parseScapeFile(JSON.stringify(file)).scape.objectOrder).toHaveLength(1);
    expect(file.scape).toEqual(captureAsScape(source));
    expect(await importLibrary(result.text, db)).toBe(1);
    const captures = await repository.listCaptures();
    expect(captures).toHaveLength(2);
    expect(captures.map((c) => c.text)).toEqual([source.text, source.text]);
    expect(captures[0].id).not.toBe(captures[1].id);
    expect(await db.scapes.count()).toBe(0);
  });

  it("deletes only archived notes and frees Inbox capacity", async () => {
    const note = await repository.capture("Temporary thought");
    await expect(repository.deleteCapture(note.id)).rejects.toThrow(/Archive/);
    await repository.updateCapture(note.id, { archived: true });
    await repository.deleteCapture(note.id);
    expect(await repository.listCaptures()).toEqual([]);
    await expect(repository.deleteCapture(note.id)).resolves.toBeUndefined();
  });

  it("does not count Inbox notes toward the 1,000-scape backup limit", async () => {
    const template = captureAsScape(await repository.capture("Library note"));
    await db.scapes.bulkAdd(
      Array.from({ length: 1000 }, (_, i) => ({
        id: `scp_${i}`,
        name: `Scape ${i}`,
        updatedAt: 1,
        objectCount: 1,
        snapshot: { ...template, id: `scp_${i}`, name: `Scape ${i}`, meta: {} },
        version: 1,
      })),
    );
    const result = await exportLibrary(db);
    expect(result.exported).toBe(1001);
    const fresh = new PrecipiceDb(`workspace-${crypto.randomUUID()}`);
    try {
      expect(await importLibrary(result.text, fresh)).toBe(1001);
      expect(await fresh.scapes.count()).toBe(1000);
      expect(await new WorkspaceRepository(fresh).listCaptures()).toHaveLength(1);
    } finally {
      await fresh.delete();
    }
  });

  it("imports a malformed Inbox marker as an ordinary scape instead of failing", async () => {
    await repository.capture("Valid text");
    const text = JSON.stringify({
      format: "precipice-library",
      version: 1,
      scapes: [JSON.parse((await exportLibrary(db)).text).scapes[0]],
    }).replace('"body":"Valid text"', '"body":""');
    expect(await importLibrary(text, db)).toBe(1);
    expect(await db.scapes.count()).toBe(1);
  });

  it("ignores malformed settings and never confuses them with captured content", async () => {
    await db.settings.put({ key: WORKSPACE_KEYS.capture + "invalid", value: { text: "bad" } });
    expect(await repository.listCaptures()).toEqual([]);
  });
});
