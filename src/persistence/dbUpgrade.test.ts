import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { PrecipiceDb } from "./db";

describe("v2 -> v3 upgrade", () => {
  it("carries existing rows forward and adds mcpOperations", async () => {
    const name = `precipice-upgrade-${Date.now()}`;
    // Exactly the schema shipped to live users today.
    const old = new Dexie(name);
    old.version(1).stores({ scapes: "id, updatedAt", actions: "++id, scapeId, ts, txId", settings: "key" });
    old.version(2).stores({ publications: "scapeId, publicationId, status" });
    await old.open();
    expect(old.verno).toBe(2);
    await old.table("scapes").put({ id: "s1", name: "Live scape", updatedAt: 1, objectCount: 3, snapshot: { id: "s1" }, version: 2 });
    await old.table("settings").put({ key: "theme", value: "dark" });
    await old.table("publications").put({ scapeId: "s1", publicationId: "p1", status: "published" });
    old.close();

    const next = new PrecipiceDb(name);
    await next.open();
    expect(next.verno).toBe(3);
    expect((await next.scapes.get("s1"))?.name).toBe("Live scape");
    expect(await next.settings.get("theme")).toBeTruthy();
    expect(await next.publications.get("s1")).toBeTruthy();
    await next.mcpOperations.put({ key: "k1", scapeId: "s1", command: { id: "c", tool: "apply_changes", args: {} }, fingerprint: "f", expiresAt: 1, result: { status: "applied" } } as never);
    expect(await next.mcpOperations.get("k1")).toBeTruthy();
    next.close();
  });

  it("opens cleanly on a brand new browser", async () => {
    const fresh = new PrecipiceDb(`precipice-fresh-${Date.now()}`);
    await fresh.open();
    expect(fresh.verno).toBe(3);
    expect(fresh.tables.map((t) => t.name).sort()).toEqual(["actions", "mcpOperations", "publications", "scapes", "settings"]);
    fresh.close();
  });
});
