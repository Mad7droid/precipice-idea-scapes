import { describe, expect, it, vi } from "vitest";
import { fixtureScape } from "@/core/fixtures";
import { MemoryScapeRepository } from "./memoryRepository";
import { ContentSearch } from "./contentSearch";

describe("local content search", () => {
  it("finds body content without its title, refreshes edits, and removes deleted results", async () => {
    const repo = new MemoryScapeRepository();
    const scape = fixtureScape();
    await repo.saveSnapshot(scape, 1);
    const index = new ContentSearch(repo);
    const get = vi.spyOn(repo, "get");
    const first = await index.search("abandon identity");
    expect(first).toEqual(
      expect.arrayContaining([expect.objectContaining({ scapeId: scape.id, objectId: "brief" })]),
    );
    get.mockClear();
    await index.search("deposit");
    expect(get).not.toHaveBeenCalled();
    const next = structuredClone(scape);
    next.updatedAt++;
    next.objects.brief.data.body = "A new uncommon phrase: durable capture";
    await repo.saveSnapshot(next, 2);
    expect(await index.search("durable capture")).toEqual(
      expect.arrayContaining([expect.objectContaining({ objectId: "brief" })]),
    );
    await repo.remove(scape.id);
    expect(await index.search("durable capture")).toEqual([]);
  });

  it("does not index instructions and cancels before snapshot reads", async () => {
    const repo = new MemoryScapeRepository();
    const scape = fixtureScape();
    scape.instructions = { body: "private-instruction-token", version: 1 };
    await repo.saveSnapshot(scape, 1);
    expect(await new ContentSearch(repo).search("private-instruction-token")).toEqual([]);
    const get = vi.spyOn(repo, "get");
    const controller = new AbortController();
    controller.abort();
    expect(await new ContentSearch(repo).search("deposit", controller.signal)).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it("reports a scape-name match once instead of returning every block", async () => {
    const repo = new MemoryScapeRepository();
    const scape = fixtureScape();
    await repo.saveSnapshot(scape, 1);
    const term = scape.name.split(/\s+/)[0];
    const results = await new ContentSearch(repo).search(term);
    const blockHits = results.filter((r) => r.objectId);
    const literal = Object.values(scape.objects).filter((o) =>
      JSON.stringify([o.title, o.data, o.tags, o.type])
        .toLocaleLowerCase()
        .includes(term.toLocaleLowerCase()),
    );
    expect(results.filter((r) => !r.objectId)).toHaveLength(1);
    expect(blockHits.length).toBeLessThanOrEqual(literal.length);
    expect(blockHits.length).toBeLessThan(scape.objectOrder.length);
  });
});
