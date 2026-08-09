import { describe, expect, it } from "vitest";
import type { Action, ActionPayload } from "./actions";
import { emptyScape, fixtureScape } from "./fixtures";
import { applyAction, applyTransaction, transaction } from "./reducer";
import type { Scape } from "./types";

const TS = 1_700_000_000_000;

function act(payload: ActionPayload, txId = "tx_test"): Action {
  return { ...payload, txId, ts: TS } as Action;
}

/** Apply then immediately undo. State must come back byte-identical. */
function expectRoundTrip(state: Scape, action: Action) {
  const forward = applyAction(state, action);
  expect(forward.inverse, `${action.type} produced no inverse`).not.toBeNull();
  const back = applyAction(forward.state, forward.inverse!);
  // updatedAt is stamped on every apply, so compare everything else.
  expect({ ...back.state, updatedAt: 0 }).toEqual({ ...state, updatedAt: 0 });
}

describe("applyAction — inverse round-trips", () => {
  it("CreateObject", () => {
    expectRoundTrip(
      fixtureScape(),
      act({
        type: "CreateObject",
        id: "n1",
        objectType: "note",
        title: "New",
        data: { body: "x" },
      }),
    );
  });

  it("UpdateObject with a title-only patch leaves data untouched on undo", () => {
    const state = fixtureScape();
    const before = state.objects["brief"].data;
    const action = act({ type: "UpdateObject", id: "brief", patch: { title: "Renamed" } });
    const forward = applyAction(state, action);
    expect(forward.state.objects["brief"].title).toBe("Renamed");
    expect(forward.state.objects["brief"].data).toEqual(before);
    expect(forward.inverse).toMatchObject({ patch: { title: "Onboarding brief" } });
    expect(forward.inverse).not.toHaveProperty("patch.data");
    expectRoundTrip(state, action);
  });

  it("MoveObject", () => {
    expectRoundTrip(fixtureScape(), act({ type: "MoveObject", id: "brief", x: 42, y: -7 }));
  });

  it("DeleteObject restores the object, its position in order, and its incident edges", () => {
    const state = fixtureScape();
    const incident = Object.values(state.relationships).filter(
      (r) => r.from === "happy-path" || r.to === "happy-path",
    );
    expect(incident.length).toBeGreaterThan(3);

    const action = act({ type: "DeleteObject", id: "happy-path" });
    const forward = applyAction(state, action);
    expect(forward.state.objects["happy-path"]).toBeUndefined();
    for (const r of incident) expect(forward.state.relationships[r.id]).toBeUndefined();

    expectRoundTrip(state, action);
  });

  it("ConnectObjects", () => {
    expectRoundTrip(
      fixtureScape(),
      act({ type: "ConnectObjects", id: "rel-new", from: "brief", to: "constraints", label: "x" }),
    );
  });

  it("DisconnectObjects", () => {
    expectRoundTrip(fixtureScape(), act({ type: "DisconnectObjects", id: "r-brief-happy" }));
  });

  it("DuplicateObject", () => {
    expectRoundTrip(
      fixtureScape(),
      act({ type: "DuplicateObject", id: "brief", newId: "brief-copy" }),
    );
  });

  it("RenameScape", () => {
    expectRoundTrip(fixtureScape(), act({ type: "RenameScape", name: "Something else" }));
  });

  it("SetViewState", () => {
    expectRoundTrip(
      fixtureScape(),
      act({ type: "SetViewState", viewState: { x: 10, y: 20, zoom: 0.5 } }),
    );
  });

  it("LayoutScape", () => {
    const state = fixtureScape();
    const positions = Object.fromEntries(
      state.objectOrder.map((id, i) => [id, { x: i * 100, y: i * 50 }]),
    );
    expectRoundTrip(state, act({ type: "LayoutScape", positions }));
  });

  it("MergeObjectData", () => {
    expectRoundTrip(
      fixtureScape(),
      act({ type: "MergeObjectData", id: "brief", data: { body: "rewritten" } }),
    );
  });

  it("ResizeObject", () => {
    expectRoundTrip(fixtureScape(), act({ type: "ResizeObject", id: "brief", width: 520 }));
  });
});

describe("MergeObjectData", () => {
  it("merges into data rather than replacing it", () => {
    const state = fixtureScape();
    const before = state.objects["brief"].data;
    const result = applyAction(
      state,
      act({ type: "MergeObjectData", id: "brief", data: { pinned: true } }),
    );

    expect(result.state.objects["brief"].data).toEqual({ ...before, pinned: true });
  });

  /**
   * The reason this action exists at all. A merge cannot express "remove the key I added",
   * so a counter-merge would leave `pinned` behind forever and undo would quietly stop
   * meaning undo.
   */
  it("inverts to a total replace, so undo removes a key the merge added", () => {
    const state = fixtureScape();
    const action = act({ type: "MergeObjectData", id: "brief", data: { pinned: true } });
    const forward = applyAction(state, action);

    expect(forward.inverse).toMatchObject({ type: "UpdateObject", id: "brief" });

    const back = applyAction(forward.state, forward.inverse!);
    expect(back.state.objects["brief"].data).not.toHaveProperty("pinned");
    expect(back.state.objects["brief"].data).toEqual(state.objects["brief"].data);
  });

  it("leaves keys the merge did not mention alone", () => {
    const state = fixtureScape();
    const merged = applyAction(
      state,
      act({ type: "MergeObjectData", id: "brief", data: { pinned: true } }),
    ).state;

    for (const [key, value] of Object.entries(state.objects["brief"].data)) {
      expect(merged.objects["brief"].data[key]).toEqual(value);
    }
  });
});

describe("ResizeObject", () => {
  it("omits width on the inverse when the card had no explicit width", () => {
    const state = fixtureScape();
    const forward = applyAction(state, act({ type: "ResizeObject", id: "brief", width: 520 }));

    // Not `width: <today's default>`: an inverse that stamps the current default would freeze
    // it onto the card, so changing the default later would no longer move it.
    expect(forward.inverse).toEqual({
      type: "ResizeObject",
      id: "brief",
      txId: "tx_test",
      ts: TS,
    });
    expect(applyAction(forward.state, forward.inverse!).state.objects["brief"]).not.toHaveProperty(
      "width",
    );
  });

  it("round-trips back to a previous explicit width", () => {
    const sized = applyAction(
      fixtureScape(),
      act({ type: "ResizeObject", id: "brief", width: 300 }),
    ).state;
    expectRoundTrip(sized, act({ type: "ResizeObject", id: "brief", width: 520 }));
  });
});

describe("applyAction — no-ops produce no inverse", () => {
  const cases: Array<[string, ActionPayload]> = [
    ["move a missing object", { type: "MoveObject", id: "nope", x: 1, y: 1 }],
    ["delete a missing object", { type: "DeleteObject", id: "nope" }],
    ["update a missing object", { type: "UpdateObject", id: "nope", patch: { title: "x" } }],
    [
      "create a duplicate id",
      { type: "CreateObject", id: "brief", objectType: "note", title: "x" },
    ],
    ["move to the current position", { type: "MoveObject", id: "brief", x: 0, y: 0 }],
    ["rename to the current name", { type: "RenameScape", name: "Fintech onboarding" }],
    ["update with an empty patch", { type: "UpdateObject", id: "brief", patch: {} }],
    ["merge an empty object", { type: "MergeObjectData", id: "brief", data: {} }],
    ["merge into a missing object", { type: "MergeObjectData", id: "nope", data: { a: 1 } }],
    ["resize a missing object", { type: "ResizeObject", id: "nope", width: 400 }],
    ["resize to the width it already has", { type: "ResizeObject", id: "brief" }],
  ];

  for (const [name, payload] of cases) {
    it(name, () => {
      const state = fixtureScape();
      const result = applyAction(state, act(payload));
      expect(result.inverse).toBeNull();
      expect(result.state).toBe(state);
    });
  }
});

describe("ConnectObjects endpoint validation", () => {
  it("drops an edge whose target does not exist yet", () => {
    const state = fixtureScape();
    const result = applyAction(
      state,
      act({ type: "ConnectObjects", id: "r-bad", from: "brief", to: "not-created-yet" }),
    );
    expect(result.inverse).toBeNull();
    expect(result.state.relationships["r-bad"]).toBeUndefined();
  });

  it("drops an edge whose source does not exist", () => {
    const state = fixtureScape();
    const result = applyAction(
      state,
      act({ type: "ConnectObjects", id: "r-bad", from: "ghost", to: "brief" }),
    );
    expect(result.inverse).toBeNull();
  });

  it("drops a self-edge", () => {
    const state = fixtureScape();
    const result = applyAction(
      state,
      act({ type: "ConnectObjects", id: "r-self", from: "brief", to: "brief" }),
    );
    expect(result.inverse).toBeNull();
  });
});

describe("CreateObject never accepts coordinates", () => {
  it("places new objects at the origin for the engine to lay out", () => {
    const state = emptyScape("scp_t");
    const result = applyAction(
      state,
      // Even if a caller smuggles x/y through, the reducer reads neither.
      act({ type: "CreateObject", id: "a", objectType: "note", title: "A" } as never),
    );
    expect(result.state.objects["a"].x).toBe(0);
    expect(result.state.objects["a"].y).toBe(0);
  });
});

describe("transactions", () => {
  it("a whole generation undoes to exactly the pre-generation state", () => {
    const before = emptyScape("scp_t");
    const actions = transaction(
      [
        { type: "CreateObject", id: "a", objectType: "note", title: "A" },
        { type: "CreateObject", id: "b", objectType: "note", title: "B" },
        { type: "ConnectObjects", id: "r1", from: "a", to: "b" },
        { type: "UpdateObject", id: "a", patch: { title: "A prime" } },
      ],
      "tx_gen",
      TS,
    );

    const forward = applyTransaction(before, actions);
    expect(Object.keys(forward.state.objects)).toHaveLength(2);
    expect(Object.keys(forward.state.relationships)).toHaveLength(1);

    const undone = applyTransaction(forward.state, forward.inverses);
    expect({ ...undone.state, updatedAt: 0 }).toEqual({ ...before, updatedAt: 0 });
  });

  it("stamps every action in a transaction with the same txId", () => {
    const actions = transaction(
      [
        { type: "CreateObject", id: "a", objectType: "note", title: "A" },
        { type: "CreateObject", id: "b", objectType: "note", title: "B" },
      ],
      "tx_one",
      TS,
    );
    expect(new Set(actions.map((a) => a.txId))).toEqual(new Set(["tx_one"]));
  });
});
