import { describe, expect, it } from "vitest";
import {
  canonicalHash,
  canonicalize,
  LIMITS,
  publishedScapeSchema,
  type PublishedScape,
} from "./contract";

function projection(overrides: Partial<PublishedScape> = {}): PublishedScape {
  return {
    name: "Onboarding",
    objects: [{ id: "obj_1", type: "note", title: "Welcome", data: { body: "hi" }, x: 0, y: 0 }],
    relationships: [],
    viewState: { x: 0, y: 0, zoom: 1 },
    ...overrides,
  };
}

describe("canonicalize", () => {
  it("is insensitive to key insertion order", () => {
    const a = { name: "x", objects: [], relationships: [] };
    const b = { relationships: [], objects: [], name: "x" };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it("sorts keys at every depth, not just the top", () => {
    expect(canonicalize({ a: { z: 1, y: 2 } })).toBe(canonicalize({ a: { y: 2, z: 1 } }));
  });

  it("preserves array order, because reordering objects is a real change", () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it("drops undefined predictably rather than leaving it to stringify", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
  });
});

describe("canonicalHash", () => {
  it("is 64 hex characters and stable across equivalent projections", async () => {
    const hash = await canonicalHash(projection());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await canonicalHash(projection())).toBe(hash);
  });

  it("changes when the projection changes", async () => {
    expect(await canonicalHash(projection())).not.toBe(
      await canonicalHash(projection({ name: "Different" })),
    );
  });
});

describe("publishedScapeSchema", () => {
  it("accepts a well-formed projection", () => {
    expect(publishedScapeSchema.safeParse(projection()).success).toBe(true);
  });

  it("rejects more objects than the cap — a huge publication is a DoS on the reader", () => {
    const objects = Array.from({ length: LIMITS.objects + 1 }, (_, i) => ({
      id: `obj_${i}`,
      type: "note",
      title: "",
      data: {},
      x: 0,
      y: 0,
    }));
    expect(publishedScapeSchema.safeParse(projection({ objects })).success).toBe(false);
  });

  it("rejects an over-long title", () => {
    const objects = [{ ...projection().objects[0], title: "a".repeat(LIMITS.title + 1) }];
    expect(publishedScapeSchema.safeParse(projection({ objects })).success).toBe(false);
  });

  it("rejects oversized object data by bytes, not characters", () => {
    const objects = [
      { ...projection().objects[0], data: { body: "x".repeat(LIMITS.objectDataBytes) } },
    ];
    expect(publishedScapeSchema.safeParse(projection({ objects })).success).toBe(false);
  });

  it("rejects NaN and Infinity coordinates", () => {
    for (const x of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const objects = [{ ...projection().objects[0], x }];
      expect(publishedScapeSchema.safeParse(projection({ objects })).success).toBe(false);
    }
  });

  it("strips fields the projection deliberately does not carry", () => {
    const parsed = publishedScapeSchema.parse({
      ...projection(),
      id: "scape_local",
      createdAt: 1,
      actionLog: [],
      meta: { starter: "journey" },
    } as unknown);
    expect(parsed).not.toHaveProperty("id");
    expect(parsed).not.toHaveProperty("createdAt");
    expect(parsed).not.toHaveProperty("actionLog");
    expect(parsed).not.toHaveProperty("meta");
  });
});
