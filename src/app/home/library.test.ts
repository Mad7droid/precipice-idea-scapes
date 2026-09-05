import { describe, it, expect, vi } from "vitest";
import type { ScapeSummary, PublicationRecord } from "@/core/types";
import { DEFAULT_PREFERENCES, readPreferences, selectScapes, withHomeLease } from "./library";
import { acquireScapeLease } from "@/persistence/lease";
import { setEditorIntent, takeEditorIntent } from "../pending";
vi.mock("@/persistence/lease", () => ({ acquireScapeLease: vi.fn() }));
const scapes: ScapeSummary[] = [
  { id: "b", name: "Beta", updatedAt: 2, objectCount: 0, relationshipCount: 0, typeCounts: {} },
  { id: "a", name: "Alpha", updatedAt: 1, objectCount: 0, relationshipCount: 0, typeCounts: {} },
];
const publications = new Map<string, PublicationRecord>([
  [
    "b",
    {
      scapeId: "b",
      publicationId: "p",
      status: "published",
      version: 1,
      publishedHash: "hash",
      updatedAt: 1,
    },
  ],
]);
describe("home library", () => {
  it("combines search, filtering, and sorting without changing repository order", () => {
    expect(
      selectScapes(scapes, " ALP ", DEFAULT_PREFERENCES, new Set(), publications).map((s) => s.id),
    ).toEqual(["a"]);
    expect(
      selectScapes(
        scapes,
        "",
        { ...DEFAULT_PREFERENCES, sort: "name" },
        new Set(),
        publications,
      ).map((s) => s.id),
    ).toEqual(["a", "b"]);
    expect(
      selectScapes(
        scapes,
        "",
        { ...DEFAULT_PREFERENCES, filter: "pinned" },
        new Set(["a"]),
        publications,
      ).map((s) => s.id),
    ).toEqual(["a"]);
    expect(
      selectScapes(
        scapes,
        "",
        { ...DEFAULT_PREFERENCES, filter: "published" },
        new Set(),
        publications,
      ).map((s) => s.id),
    ).toEqual(["b"]);
    expect(scapes[0].id).toBe("b");
  });
  it("defaults safely for invalid saved preferences", () => {
    expect(readPreferences({ view: "future", filter: 42 })).toEqual(DEFAULT_PREFERENCES);
    expect(readPreferences(null)).toEqual(DEFAULT_PREFERENCES);
  });
  it("rejects mutations when another editor holds the lease and releases its resources", async () => {
    const stop = vi.fn(),
      operation = vi.fn();
    vi.mocked(acquireScapeLease).mockReturnValue({
      settled: Promise.resolve("follower"),
      status: () => "follower",
      stop,
      takeOver: vi.fn(),
    });
    await expect(withHomeLease("a", operation)).rejects.toThrow("another tab");
    expect(operation).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
  });
  it("releases the lease even when a mutation fails", async () => {
    const stop = vi.fn();
    vi.mocked(acquireScapeLease).mockReturnValue({
      settled: Promise.resolve("holder"),
      status: () => "holder",
      stop,
      takeOver: vi.fn(),
    });
    await expect(
      withHomeLease("a", async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("offline");
    expect(stop).toHaveBeenCalledOnce();
  });
  it("consumes panel intents exactly once and never on the wrong scape", () => {
    for (const panel of ["publish", "scapi", "agent"] as const) {
      setEditorIntent("a", panel);
      expect(takeEditorIntent("a")).toBe(panel);
      expect(takeEditorIntent("a")).toBeNull();
    }
    setEditorIntent("a", "publish");
    expect(takeEditorIntent("b")).toBeNull();
    expect(takeEditorIntent("a")).toBeNull();
  });
});
