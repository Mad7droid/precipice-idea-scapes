import { beforeEach, describe, expect, it } from "vitest";
import { emptyScape, fixtureScape } from "./fixtures";
import { useScapeStore } from "./store";

const store = () => useScapeStore.getState();

beforeEach(() => {
  useScapeStore.getState().loadScape(emptyScape("scp_t"));
});

describe("undo groups on txId", () => {
  it("one transaction is one undo step regardless of how many actions it contains", () => {
    store().dispatchTx(
      [
        { type: "CreateObject", id: "a", objectType: "note", title: "A" },
        { type: "CreateObject", id: "b", objectType: "note", title: "B" },
        { type: "CreateObject", id: "c", objectType: "note", title: "C" },
        { type: "ConnectObjects", id: "r1", from: "a", to: "b" },
      ],
      "tx_gen",
    );

    expect(store().undoStack).toHaveLength(1);
    expect(store().undoStack[0].size).toBe(4);
    expect(Object.keys(store().scape!.objects)).toHaveLength(3);

    store().undo();
    expect(Object.keys(store().scape!.objects)).toHaveLength(0);
    expect(Object.keys(store().scape!.relationships)).toHaveLength(0);
  });

  it("separate txIds are separate undo steps", () => {
    store().dispatchTx([{ type: "CreateObject", id: "a", objectType: "note", title: "A" }]);
    store().dispatchTx([{ type: "MoveObject", id: "a", x: 100, y: 100 }]);

    expect(store().undoStack).toHaveLength(2);

    // First undo reverses the drag only.
    store().undo();
    expect(store().scape!.objects["a"]).toBeDefined();
    expect(store().scape!.objects["a"].x).toBe(0);

    // Second undo reverses the creation.
    store().undo();
    expect(store().scape!.objects["a"]).toBeUndefined();
  });

  it("undo of a generation returns state to exactly pre-generation", () => {
    useScapeStore.getState().loadScape(fixtureScape());
    const before = structuredClone(store().scape!);

    store().dispatchTx(
      [
        { type: "CreateObject", id: "gen1", objectType: "note", title: "Generated" },
        { type: "CreateObject", id: "gen2", objectType: "journey", title: "Flow" },
        { type: "ConnectObjects", id: "genr", from: "gen1", to: "gen2" },
        { type: "DeleteObject", id: "copy-rules" },
      ],
      "tx_gen",
    );

    store().undo();
    expect({ ...store().scape!, updatedAt: 0 }).toEqual({ ...before, updatedAt: 0 });
  });
});

describe("camera moves are not edits", () => {
  it("applies and logs SetViewState but never pushes an undo step", () => {
    store().dispatchTx([{ type: "SetViewState", viewState: { x: 10, y: 20, zoom: 0.68 } }]);

    expect(store().scape!.viewState).toEqual({ x: 10, y: 20, zoom: 0.68 });
    // Persistence still needs to see it — the viewport survives a refresh.
    expect(store().actionLog.map((a) => a.type)).toEqual(["SetViewState"]);
    expect(store().undoStack).toHaveLength(0);
  });

  it("leaves Cmd+Z reversing the last real edit, not the last pan", () => {
    store().dispatchTx([{ type: "CreateObject", id: "a", objectType: "note", title: "A" }]);
    // The user pans around for a while before pressing undo.
    store().dispatchTx([{ type: "SetViewState", viewState: { x: 1, y: 1, zoom: 0.5 } }]);
    store().dispatchTx([{ type: "SetViewState", viewState: { x: 2, y: 2, zoom: 0.6 } }]);

    expect(store().undoStack).toHaveLength(1);
    store().undo();
    expect(store().scape!.objects["a"]).toBeUndefined();
    // The camera stays where the user left it.
    expect(store().scape!.viewState).toEqual({ x: 2, y: 2, zoom: 0.6 });
  });
});

describe("redo", () => {
  it("round-trips through undo and back", () => {
    store().dispatchTx([
      { type: "CreateObject", id: "a", objectType: "note", title: "A" },
      { type: "CreateObject", id: "b", objectType: "note", title: "B" },
    ]);
    const after = structuredClone(store().scape!);

    store().undo();
    expect(Object.keys(store().scape!.objects)).toHaveLength(0);

    store().redo();
    expect({ ...store().scape!, updatedAt: 0 }).toEqual({ ...after, updatedAt: 0 });
  });

  it("a new dispatch clears the redo stack", () => {
    store().dispatchTx([{ type: "CreateObject", id: "a", objectType: "note", title: "A" }]);
    store().undo();
    expect(store().redoStack).toHaveLength(1);

    store().dispatchTx([{ type: "CreateObject", id: "z", objectType: "note", title: "Z" }]);
    expect(store().redoStack).toHaveLength(0);
  });
});

describe("action log", () => {
  it("records applied actions and drains empty", () => {
    store().dispatchTx([
      { type: "CreateObject", id: "a", objectType: "note", title: "A" },
      { type: "CreateObject", id: "b", objectType: "note", title: "B" },
    ]);

    const drained = store().drainActionLog();
    expect(drained).toHaveLength(2);
    expect(store().drainActionLog()).toHaveLength(0);
  });

  it("does not record no-ops", () => {
    store().dispatchTx([{ type: "MoveObject", id: "does-not-exist", x: 1, y: 1 }]);
    expect(store().drainActionLog()).toHaveLength(0);
    expect(store().undoStack).toHaveLength(0);
  });

  it("records the inverses applied by undo, so persistence sees the real history", () => {
    store().dispatchTx([{ type: "CreateObject", id: "a", objectType: "note", title: "A" }]);
    store().drainActionLog();

    store().undo();
    const drained = store().drainActionLog();
    expect(drained).toHaveLength(1);
    expect(drained[0].type).toBe("DeleteObject");
  });
});
