import { describe, expect, it } from "vitest";
import { emptyScape } from "@/core/fixtures";
import type { ActionPayload } from "@/core/actions";
import { applyBatch, canonical, digest, revision, validateChanges } from "./document";

const note = (id: string, body = "") => ({
  type: "CreateObject" as const,
  id,
  objectType: "note",
  title: id,
  data: { body },
});

const base = () => {
  const scape = emptyScape("scp_1", "Onboarding");
  return applyBatch(scape, [note("a"), note("b")] as ActionPayload[], "tx_seed").state;
};

describe("canonical", () => {
  it("orders keys so two equal documents serialise identically", () => {
    expect(canonical({ b: 1, a: 2 })).toBe(canonical({ a: 2, b: 1 }));
    expect(canonical({ a: 1 })).not.toBe(canonical({ a: 2 }));
  });

  it("preserves array order, which is meaningful", () => {
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
  });

  it("drops undefined values, so an absent key and an undefined one agree", () => {
    expect(canonical({ a: 1, b: undefined })).toBe(canonical({ a: 1 }));
  });
});

describe("revision", () => {
  it("is stable across key order and changes with content", async () => {
    const scape = base();
    expect(await revision(scape)).toBe(await revision({ ...scape }));

    const edited = applyBatch(scape, [note("c")] as ActionPayload[], "tx_2").state;
    expect(await revision(edited)).not.toBe(await revision(scape));
  });

  it("ignores camera movement and timestamps, so panning is not a conflict", async () => {
    const scape = base();
    const panned = {
      ...scape,
      viewState: { x: 900, y: -400, zoom: 3 },
      updatedAt: scape.updatedAt + 60_000,
      createdAt: scape.createdAt + 1,
    };
    expect(await revision(panned)).toBe(await revision(scape));
  });

  it("hashes with SHA-256", async () => {
    expect(await digest({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("validateChanges", () => {
  it("returns the parsed actions and the state they would produce, without touching the input", () => {
    const scape = base();
    const { actions, state } = validateChanges(scape, [note("c")]);
    expect(actions).toHaveLength(1);
    expect(Object.keys(state.objects)).toHaveLength(3);
    expect(Object.keys(scape.objects)).toHaveLength(2);
  });

  it("validates against the running batch, so a relationship can reference an object created in it", () => {
    const { state } = validateChanges(base(), [
      note("c"),
      { type: "ConnectObjects", id: "r1", from: "a", to: "c" },
    ]);
    expect(Object.keys(state.relationships)).toHaveLength(1);
  });

  /**
   * All-or-nothing, deliberately unlike the app's "drop the invalid action and count it" rule.
   * An MCP batch is a transaction: a half-applied one is worse than a rejected one.
   */
  it("throws on the first invalid action rather than dropping it", () => {
    const scape = base();
    expect(() => validateChanges(scape, [note("c"), note("a")])).toThrow(/duplicate_id: a/);
    expect(() =>
      validateChanges(scape, [{ type: "UpdateObject", id: "zz", patch: { title: "x" } }]),
    ).toThrow(/not_found: zz/);
    expect(() => validateChanges(scape, [{ type: "DeleteObject", id: "zz" }])).toThrow(
      /not_found: zz/,
    );
    expect(() => validateChanges(scape, [{ type: "DisconnectObjects", id: "r9" }])).toThrow(
      /not_found: r9/,
    );
  });

  it("rejects relationships that dangle or loop back on themselves", () => {
    const scape = base();
    for (const bad of [
      { type: "ConnectObjects", id: "r1", from: "a", to: "zz" },
      { type: "ConnectObjects", id: "r1", from: "zz", to: "a" },
      { type: "ConnectObjects", id: "r1", from: "a", to: "a" },
    ]) {
      expect(() => validateChanges(scape, [bad])).toThrow(/invalid_relationship/);
    }
  });

  it("refuses prototype-polluting ids", () => {
    for (const id of ["__proto__", "constructor", "prototype"]) {
      expect(() => validateChanges(base(), [note(id)])).toThrow(/duplicate_id/);
    }
  });

  it("honours an allowed-type restriction", () => {
    expect(() => validateChanges(base(), [note("c")], ["journey"])).toThrow(
      /unsupported_type: note/,
    );
    expect(validateChanges(base(), [note("c")], ["note", "journey"]).actions).toHaveLength(1);
  });

  it("validates replacement data on update against the target's own schema", () => {
    const scape = base();
    expect(() =>
      validateChanges(scape, [{ type: "UpdateObject", id: "a", patch: { data: { steps: [] } } }]),
    ).toThrow();
    const { actions } = validateChanges(scape, [
      { type: "UpdateObject", id: "a", patch: { data: { body: "replaced" } } },
    ]);
    expect(actions[0]).toMatchObject({ patch: { data: { body: "replaced" } } });
  });

  it("rejects a change that is not in the contract at all", () => {
    expect(() => validateChanges(base(), [{ type: "SetInstructions", body: "do this" }])).toThrow();
    expect(() => validateChanges(base(), [{ type: "MoveObject", id: "a", x: 1, y: 2 }])).toThrow();
  });
});

describe("applyBatch", () => {
  it("stamps one txId across the batch, so it is one undo step", () => {
    const { actions } = applyBatch(base(), [note("c"), note("d")] as ActionPayload[], "tx_mcp");
    expect(actions.map((action) => action.txId)).toEqual(["tx_mcp", "tx_mcp"]);
  });

  it("orders inverses so replaying them front to back reverses the batch", () => {
    const scape = base();
    const { state, inverses } = applyBatch(
      scape,
      [note("c"), { type: "ConnectObjects", id: "r1", from: "a", to: "c" }] as ActionPayload[],
      "tx_mcp",
    );
    expect(Object.keys(state.objects)).toHaveLength(3);

    // The relationship must be undone before the object it depends on.
    expect(inverses[0].type).toBe("DisconnectObjects");
    expect(inverses[1].type).toBe("DeleteObject");
  });

  it("records nothing for an action the reducer treats as a no-op", () => {
    const scape = base();
    const { actions, inverses } = applyBatch(
      scape,
      [{ type: "UpdateObject", id: "zz", patch: { title: "gone" } }] as ActionPayload[],
      "tx_mcp",
    );
    expect(actions).toHaveLength(0);
    expect(inverses).toHaveLength(0);
  });
});
