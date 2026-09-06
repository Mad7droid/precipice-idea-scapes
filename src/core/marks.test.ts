import { describe, expect, it } from "vitest";
import type { Action, ActionPayload } from "./actions";
import { fixtureScape } from "./fixtures";
import { MAX_TAGS, MAX_TAG_LENGTH, markColor, normalizeAccent, normalizeTags } from "./marks";
import { applyAction } from "./reducer";
import { toPlainScape } from "./serialize";
import type { Scape } from "./types";

const TS = 1_700_000_000_000;
const act = (payload: ActionPayload, txId = "tx_marks"): Action =>
  ({ ...payload, txId, ts: TS }) as Action;

describe("normalizeTags", () => {
  it("trims, collapses whitespace and drops empties", () => {
    expect(normalizeTags(["  phase   one ", "", "   "])).toEqual(["phase one"]);
  });

  it("de-duplicates case-insensitively, keeping the first spelling", () => {
    expect(normalizeTags(["Risk", "risk", "RISK"])).toEqual(["Risk"]);
  });

  it("truncates a long tag rather than dropping it", () => {
    const [tag] = normalizeTags(["x".repeat(MAX_TAG_LENGTH + 20)]);
    expect(tag).toHaveLength(MAX_TAG_LENGTH);
  });

  it("caps the count", () => {
    const many = Array.from({ length: MAX_TAGS + 5 }, (_, i) => `t${i}`);
    expect(normalizeTags(many)).toHaveLength(MAX_TAGS);
  });
});

describe("normalizeAccent", () => {
  it("accepts a palette name, case-insensitively", () => {
    expect(normalizeAccent("Teal")).toBe("teal");
  });

  it("clears anything the palette does not know", () => {
    expect(normalizeAccent("cerulean")).toBe("");
    expect(normalizeAccent(undefined)).toBe("");
  });

  it("resolves to a token reference, never a hex", () => {
    expect(markColor("teal")).toBe("var(--mark-teal)");
    expect(markColor("cerulean")).toBeUndefined();
  });
});

/** Apply then immediately undo. State must come back byte-identical. */
function expectRoundTrip(state: Scape, action: Action) {
  const forward = applyAction(state, action);
  expect(forward.inverse, `${action.type} produced no inverse`).not.toBeNull();
  const back = applyAction(forward.state, forward.inverse!);
  expect({ ...back.state, updatedAt: 0 }).toEqual({ ...state, updatedAt: 0 });
}

describe("markers through the reducer", () => {
  it("CreateObject stores normalised markers and omits empty ones", () => {
    const state = fixtureScape();
    const { state: next } = applyAction(
      state,
      act({
        type: "CreateObject",
        id: "m1",
        objectType: "note",
        title: "Marked",
        data: { body: "x" },
        accent: "TEAL",
        tags: ["  Risk ", "risk", "later"],
      }),
    );
    expect(next.objects["m1"].accent).toBe("teal");
    expect(next.objects["m1"].tags).toEqual(["Risk", "later"]);

    const { state: plain } = applyAction(
      state,
      act({
        type: "CreateObject",
        id: "m2",
        objectType: "note",
        title: "Plain",
        data: { body: "x" },
        accent: "not-a-colour",
        tags: [],
      }),
    );
    expect(plain.objects["m2"]).not.toHaveProperty("accent");
    expect(plain.objects["m2"]).not.toHaveProperty("tags");
  });

  it("an unknown accent never costs the object", () => {
    const state = fixtureScape();
    const { state: next } = applyAction(
      state,
      act({
        type: "CreateObject",
        id: "m3",
        objectType: "note",
        title: "Still here",
        data: { body: "x" },
        accent: "chartreuse",
      }),
    );
    expect(next.objects["m3"].title).toBe("Still here");
  });

  it("setting and clearing a marker both round-trip through undo", () => {
    const state = fixtureScape();
    expectRoundTrip(state, act({ type: "UpdateObject", id: "brief", patch: { accent: "plum" } }));

    const { state: marked } = applyAction(
      state,
      act({ type: "UpdateObject", id: "brief", patch: { accent: "plum", tags: ["a", "b"] } }),
    );
    expectRoundTrip(marked, act({ type: "UpdateObject", id: "brief", patch: { accent: "" } }));
    expectRoundTrip(marked, act({ type: "UpdateObject", id: "brief", patch: { tags: [] } }));
  });

  it("re-writing the marker a block already has is a no-op", () => {
    const { state: marked } = applyAction(
      fixtureScape(),
      act({ type: "UpdateObject", id: "brief", patch: { accent: "olive", tags: ["Now"] } }),
    );
    const repeat = applyAction(
      marked,
      act({ type: "UpdateObject", id: "brief", patch: { accent: "olive", tags: [" now "] } }),
    );
    // " now " normalises to "now", which differs in case from "Now" and so is not a no-op;
    // the identical write below is the one that must not reach the undo stack.
    expect(repeat.inverse).not.toBeNull();
    expect(
      applyAction(marked, act({ type: "UpdateObject", id: "brief", patch: { accent: "olive" } }))
        .inverse,
    ).toBeNull();
    expect(
      applyAction(marked, act({ type: "UpdateObject", id: "brief", patch: { tags: ["Now"] } }))
        .inverse,
    ).toBeNull();
  });

  it("a title-only patch leaves markers alone", () => {
    const { state: marked } = applyAction(
      fixtureScape(),
      act({ type: "UpdateObject", id: "brief", patch: { tags: ["keep"] } }),
    );
    const { state: renamed } = applyAction(
      marked,
      act({ type: "UpdateObject", id: "brief", patch: { title: "Renamed" } }),
    );
    expect(renamed.objects["brief"].tags).toEqual(["keep"]);
  });
});

describe("markers on disk", () => {
  it("survive serialisation, and a scape without them still serialises", () => {
    const state = fixtureScape();
    const { state: marked } = applyAction(
      state,
      act({ type: "UpdateObject", id: "brief", patch: { accent: "rose", tags: ["Now", "risk"] } }),
    );
    const plain = toPlainScape(marked);
    expect(plain.objects["brief"].accent).toBe("rose");
    expect(plain.objects["brief"].tags).toEqual(["Now", "risk"]);
    expect(toPlainScape(state).objects["brief"]).not.toHaveProperty("tags");
  });
});
