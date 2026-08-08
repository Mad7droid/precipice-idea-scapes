import { describe, expect, it } from "vitest";
import { actionSchema } from "@/core/actions";
import { pluginTypes } from "@/core/registry";
import { BLANK, getStarter, LAYOUT_LABELS, starterFor, STARTERS } from ".";

/**
 * A starter is data that four unrelated modules trust: the canvas reads `layout`, the AI layer
 * reads `types` and `promptHint`, the composer reads `types` again, the home page reads the
 * copy. Nothing type-checks a starter's `types` against the plugin registry, so this does.
 */
describe("starters", () => {
  it("has unique ids and no duplicate labels", () => {
    expect(new Set(STARTERS.map((s) => s.id)).size).toBe(STARTERS.length);
    expect(new Set(STARTERS.map((s) => s.label)).size).toBe(STARTERS.length);
  });

  it("only names object types that are actually registered", () => {
    const registered = pluginTypes();
    for (const starter of STARTERS) {
      for (const type of starter.types) {
        expect(registered, `${starter.id} allows unknown type "${type}"`).toContain(type);
      }
    }
  });

  it("names a layout mode the engine knows how to run", () => {
    for (const starter of STARTERS) {
      expect(Object.keys(LAYOUT_LABELS)).toContain(starter.layout);
    }
  });

  it("seeds actions the reducer will accept", () => {
    for (const starter of STARTERS) {
      if (!starter.seed) continue;
      for (const payload of starter.seed("A title")) {
        const parsed = actionSchema.safeParse({ ...payload, txId: "tx_1", ts: 1 });
        expect(parsed.success, `${starter.id} seeds an invalid action`).toBe(true);
      }
      // A seed that creates an object of a type the starter forbids would be immediately
      // unrepresentable in its own scape.
      for (const payload of starter.seed("A title")) {
        if (payload.type !== "CreateObject") continue;
        if (starter.types.length === 0) continue;
        expect(starter.types).toContain(payload.objectType);
      }
    }
  });

  it("falls back to blank rather than throwing on a starter it has never heard of", () => {
    expect(getStarter("from-a-newer-build")).toBe(BLANK);
    expect(getStarter(undefined)).toBe(BLANK);
    expect(starterFor(null)).toBe(BLANK);
    expect(starterFor({ meta: {} })).toBe(BLANK);
    expect(starterFor({ meta: { starter: "mind-map" } }).layout).toBe("radial");
  });

  it("draws relationships for the starters whose whole point is the relationships", () => {
    expect(getStarter("mind-map").edgeMode).toBe("all");
    expect(getStarter("journey-map").edgeMode).toBe("all");
  });
});
