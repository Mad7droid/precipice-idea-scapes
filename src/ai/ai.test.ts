import { describe, expect, it, vi } from "vitest";
import type { Action } from "@/core/actions";
import { emptyScape, fixtureScape, syntheticScape } from "@/core/fixtures";
import { applyAction } from "@/core/reducer";
import { useScapeStore } from "@/core/store";
import type { Scape } from "@/core/types";
import { DEFAULT_BUDGET_TOKENS, estimateTokens, projectScape } from "./context";
import { createApplier, type GenerationEvent } from "./generate";
import { ONBOARDING_RECORDING, replayRecording } from "./recording";
import { systemPrompt, userPrompt } from "./prompt";
import { proxyBaseUrl } from "./provider";
import { CONNECT_TOOL_NAMES, toolInputSchemas } from "./tools";

/** A dispatch backed by a local Scape, so nothing here touches the app's store. */
function localDispatch(initial: Scape) {
  let scape = initial;
  return {
    dispatch: (action: Action) => {
      const result = applyAction(scape, action);
      if (!result.inverse) return false;
      scape = result.state;
      return true;
    },
    get: () => scape,
  };
}

function collector() {
  const events: GenerationEvent[] = [];
  return { events, onEvent: (e: GenerationEvent) => void events.push(e) };
}

describe("tool schemas", () => {
  it("expose no way for the model to send coordinates", () => {
    const shape = toolInputSchemas.CreateObject.shape;
    expect(Object.keys(shape)).not.toContain("x");
    expect(Object.keys(shape)).not.toContain("y");
  });

  it("strip the transaction envelope — the engine stamps it, not the model", () => {
    for (const [name, schema] of Object.entries(toolInputSchemas)) {
      const keys = Object.keys((schema as { shape: object }).shape);
      expect(keys, name).not.toContain("txId");
      expect(keys, name).not.toContain("ts");
      expect(keys, name).not.toContain("type");
    }
  });

  it("accept a well-formed CreateObject", () => {
    const parsed = toolInputSchemas.CreateObject.safeParse({
      id: "verify-identity",
      objectType: "journey",
      title: "Verify identity",
      data: { steps: [] },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("the apply loop", () => {
  it("gives every action in one generation the same txId", () => {
    const local = localDispatch(emptyScape("scp_t"));
    const { events, onEvent } = collector();
    const applier = createApplier({ dispatch: local.dispatch, onEvent });

    applier.apply("CreateObject", { id: "a", objectType: "note", title: "A", data: { body: "" } });
    applier.apply("CreateObject", { id: "b", objectType: "note", title: "B", data: { body: "" } });
    applier.apply("ConnectObjects", { id: "e1", from: "a", to: "b" });

    const applied = events.filter((e) => e.kind === "applied");
    expect(applied).toHaveLength(3);
    expect(new Set(applied.map((e) => e.action.txId))).toEqual(new Set([applier.txId]));
  });

  it("drops a malformed call, counts it, and keeps going", () => {
    const local = localDispatch(emptyScape("scp_t"));
    const { events, onEvent } = collector();
    const applier = createApplier({ dispatch: local.dispatch, onEvent });

    applier.apply("CreateObject", { id: "a", objectType: "note", title: "A", data: { body: "" } });
    // Missing objectType entirely.
    applier.apply("CreateObject", { id: "b", title: "B" });
    applier.apply("CreateObject", { id: "c", objectType: "note", title: "C", data: { body: "" } });

    expect(applier.applied()).toBe(2);
    expect(applier.skipped()).toBe(1);
    expect(local.get().objectOrder).toEqual(["a", "c"]);
    expect(events.find((e) => e.kind === "skipped")).toBeDefined();
  });

  it("returns the reason to the model so it can correct itself", () => {
    const local = localDispatch(emptyScape("scp_t"));
    const { onEvent } = collector();
    const applier = createApplier({ dispatch: local.dispatch, onEvent });

    const result = applier.apply("CreateObject", {
      id: "w",
      objectType: "wireframe",
      title: "W",
      data: { primitives: [{ id: "p", kind: "box", span: 99 }] },
    });

    expect(result).toMatch(/Rejected/);
    expect(result).toMatch(/span/);
  });

  it("rejects an object type this build does not have a plugin for", () => {
    const local = localDispatch(emptyScape("scp_t"));
    const { onEvent } = collector();
    const applier = createApplier({ dispatch: local.dispatch, onEvent });

    const result = applier.apply("CreateObject", {
      id: "p",
      objectType: "persona",
      title: "Someone",
      data: {},
    });

    expect(result).toMatch(/unknown object type/);
    expect(applier.applied()).toBe(0);
  });

  it("drops an edge to an object that was never created", () => {
    const local = localDispatch(emptyScape("scp_t"));
    const { events, onEvent } = collector();
    const applier = createApplier({ dispatch: local.dispatch, onEvent });

    applier.apply("CreateObject", { id: "a", objectType: "note", title: "A", data: { body: "" } });
    applier.apply("ConnectObjects", { id: "e", from: "a", to: "never-made" });

    expect(applier.skipped()).toBe(1);
    const skipped = events.find((e) => e.kind === "skipped");
    expect(skipped && "reason" in skipped && skipped.reason).toMatch(/endpoints/);
  });

  it("rejects a tool the protocol does not define", () => {
    const local = localDispatch(emptyScape("scp_t"));
    const { onEvent } = collector();
    const applier = createApplier({ dispatch: local.dispatch, onEvent });

    expect(applier.apply("DropDatabase", { table: "everything" })).toMatch(/not a known action/);
    expect(applier.applied()).toBe(0);
  });

  it("lays out every third action rather than every one", () => {
    const local = localDispatch(emptyScape("scp_t"));
    const { onEvent } = collector();
    const requestLayout = vi.fn();
    const applier = createApplier({ dispatch: local.dispatch, onEvent, requestLayout });

    for (let i = 0; i < 7; i++) {
      applier.apply("CreateObject", {
        id: `n${i}`,
        objectType: "note",
        title: `N${i}`,
        data: { body: "" },
      });
    }
    expect(requestLayout).toHaveBeenCalledTimes(2); // after the 3rd and the 6th

    applier.finish();
    expect(requestLayout).toHaveBeenCalledTimes(3); // one final reflow
  });

  it("does not lay out at all when nothing was applied", () => {
    const local = localDispatch(emptyScape("scp_t"));
    const { onEvent } = collector();
    const requestLayout = vi.fn();
    const applier = createApplier({ dispatch: local.dispatch, onEvent, requestLayout });

    applier.apply("CreateObject", { id: "bad" });
    applier.finish();
    expect(requestLayout).not.toHaveBeenCalled();
  });
});

describe("the recorded generation", () => {
  it("applies through the same path a live generation uses", async () => {
    const local = localDispatch(emptyScape("scp_t"));
    const { events, onEvent } = collector();

    const result = await replayRecording(ONBOARDING_RECORDING, {
      dispatch: local.dispatch,
      onEvent,
      delayMs: 0,
    });

    // Three calls in the recording are deliberately invalid.
    expect(result.skipped).toBe(3);
    expect(result.applied).toBe(ONBOARDING_RECORDING.calls.length - 3);

    const scape = local.get();
    expect(scape.name).toBe("Fintech onboarding");
    expect(scape.objectOrder.length).toBeGreaterThanOrEqual(6);
    expect(Object.keys(scape.relationships).length).toBeGreaterThanOrEqual(6);

    const types = new Set(Object.values(scape.objects).map((o) => o.type));
    expect(types).toContain("journey");
    expect(types).toContain("wireframe");
    expect(types).toContain("note");

    expect(events.at(-1)?.kind).toBe("done");
  });

  it("undoes the entire generation in one step", async () => {
    useScapeStore.getState().loadScape(emptyScape("scp_t", "Untitled scape"));
    const before = structuredClone(useScapeStore.getState().scape!);

    await replayRecording(ONBOARDING_RECORDING, {
      dispatch: (action) => useScapeStore.getState().dispatch(action),
      onEvent: () => {},
      delayMs: 0,
    });

    expect(useScapeStore.getState().undoStack).toHaveLength(1);
    expect(useScapeStore.getState().scape!.objectOrder.length).toBeGreaterThan(5);

    useScapeStore.getState().undo();
    expect({ ...useScapeStore.getState().scape!, updatedAt: 0 }).toEqual({
      ...before,
      updatedAt: 0,
    });
  });

  it("leaves a consistent, undoable state when cancelled mid-stream", async () => {
    useScapeStore.getState().loadScape(emptyScape("scp_t", "Untitled scape"));
    const before = structuredClone(useScapeStore.getState().scape!);

    const controller = new AbortController();
    const { events, onEvent } = collector();

    const running = replayRecording(ONBOARDING_RECORDING, {
      dispatch: (action) => useScapeStore.getState().dispatch(action),
      onEvent,
      delayMs: 1,
      signal: controller.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 6));
    controller.abort();
    const result = await running;

    expect(result.cancelled).toBe(true);
    expect(result.applied).toBeLessThan(ONBOARDING_RECORDING.calls.length);

    const scape = useScapeStore.getState().scape!;
    // Whatever landed is internally consistent: no edge points at a missing object.
    for (const rel of Object.values(scape.relationships)) {
      expect(scape.objects[rel.from]).toBeDefined();
      expect(scape.objects[rel.to]).toBeDefined();
    }

    // And the partial result still undoes as a single transaction.
    if (result.applied > 0) {
      expect(useScapeStore.getState().undoStack).toHaveLength(1);
      useScapeStore.getState().undo();
      expect({ ...useScapeStore.getState().scape!, updatedAt: 0 }).toEqual({
        ...before,
        updatedAt: 0,
      });
    }
    expect(events.at(-1)?.kind).toBe("done");
  });
});

describe("context projection", () => {
  it("stays under budget for a 200-object scape", () => {
    const scape = syntheticScape(200);
    const projection = projectScape(scape);

    expect(projection.estimatedTokens).toBeLessThanOrEqual(DEFAULT_BUDGET_TOKENS);
    expect(projection.omitted).toBeGreaterThan(0);
  });

  it("stays under budget for 200 objects even with a selection in full detail", () => {
    const scape = syntheticScape(200);
    const selection = scape.objectOrder.slice(100, 104);
    const projection = projectScape(scape, { selection });

    expect(projection.estimatedTokens).toBeLessThanOrEqual(DEFAULT_BUDGET_TOKENS);
  });

  it("respects the budget across a range of sizes and scapes", () => {
    for (const budgetTokens of [600, 1200, 2000, 4000, 8000]) {
      for (const scape of [fixtureScape(), syntheticScape(60), syntheticScape(200)]) {
        const selection = scape.objectOrder.slice(0, 4);
        for (const options of [{}, { selection }, { recent: selection }]) {
          const projection = projectScape(scape, { ...options, budgetTokens });
          expect(
            projection.estimatedTokens,
            `${scape.objectOrder.length} objects at ${budgetTokens}`,
          ).toBeLessThanOrEqual(budgetTokens);
        }
      }
    }
  });

  it("truncates the middle, never the ends", () => {
    const scape = syntheticScape(200);
    const { text } = projectScape(scape);

    expect(text).toContain(scape.objectOrder[0]);
    expect(text).toContain(scape.objectOrder[scape.objectOrder.length - 1]);
    expect(text).toMatch(/objects omitted/);
  });

  it("keeps the whole index when the scape is small", () => {
    const scape = fixtureScape();
    const projection = projectScape(scape);

    expect(projection.omitted).toBe(0);
    for (const id of scape.objectOrder) expect(projection.text).toContain(id);
  });

  it("gives selected objects and their neighbours full bodies", () => {
    const scape = fixtureScape();
    const { text } = projectScape(scape, { selection: ["happy-path"] });

    const focus = text.slice(text.indexOf("## In focus"));
    expect(focus).toContain("happy-path");
    // A direct neighbour of the selection.
    expect(focus).toContain("wf-welcome");
    // Something two hops away is not in focus.
    expect(focus).not.toContain("### copy-rules");
  });

  it("includes objects created by the last transaction in full", () => {
    const scape = fixtureScape();
    const { text } = projectScape(scape, { recent: ["drop-off"] });
    expect(text.slice(text.indexOf("## In focus"))).toContain("drop-off");
  });

  it("renders relationships as an adjacency list rather than prose", () => {
    const { text } = projectScape(fixtureScape());
    expect(text).toContain("brief -> happy-path (drives)");
  });

  it("always states the object and relationship counts, however truncated", () => {
    const projection = projectScape(syntheticScape(200));
    expect(projection.text).toContain("200 objects");
  });

  it("estimates tokens monotonically", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("constraining which types a generation may create", () => {
  it("describes only the types the user allowed, and gives examples of only those", () => {
    const all = systemPrompt();
    expect(all).toContain("wireframe:");
    expect(all).toContain("journey:");

    const notesOnly = systemPrompt({ allowedTypes: ["note"] });
    expect(notesOnly).toContain("note:");
    expect(notesOnly).not.toContain("wireframe:");
    expect(notesOnly).not.toContain("journey:");
    expect(notesOnly).toContain("Create only these types: note");
  });

  it("treats an empty list as no constraint rather than as nothing", () => {
    expect(systemPrompt({ allowedTypes: [] })).toBe(systemPrompt());
  });

  it("drops an excluded type at the apply boundary, since the prompt is a request not a rule", () => {
    const local = localDispatch(emptyScape("scp_t"));
    const { events, onEvent } = collector();
    const applier = createApplier({ dispatch: local.dispatch, onEvent, allowedTypes: ["note"] });

    applier.apply("CreateObject", { id: "a", objectType: "note", title: "A", data: { body: "" } });
    applier.apply("CreateObject", {
      id: "b",
      objectType: "wireframe",
      title: "B",
      data: { primitives: [] },
    });

    expect(applier.applied()).toBe(1);
    expect(applier.skipped()).toBe(1);
    expect(local.get().objectOrder).toEqual(["a"]);
    const skipped = events.find((e) => e.kind === "skipped");
    expect(skipped && "reason" in skipped && skipped.reason).toContain("excluded");
  });
});

describe("proxy base url", () => {
  // The AI SDK appends `/messages` to the base url. Give it a bare origin and requests land on
  // `/messages`, which the Worker 404s — surfacing as "Model unavailable", an error about the
  // model for a request that never reached Anthropic. That failure was silent and misread once.
  it("carries the version segment the AI SDK does not add", () => {
    expect(proxyBaseUrl("https://proxy.example")).toBe("https://proxy.example/v1");
  });

  it("does not double the slash when the origin has a trailing one", () => {
    expect(proxyBaseUrl("https://proxy.example/")).toBe("https://proxy.example/v1");
  });

  it("builds the path the worker actually serves", () => {
    // Mirrors `${baseURL}/messages` in @ai-sdk/anthropic.
    expect(`${proxyBaseUrl("https://proxy.example")}/messages`).toBe(
      "https://proxy.example/v1/messages",
    );
  });
});

describe("restricting a generation to the graph", () => {
  it("drops a tool the generation was never offered", () => {
    const local = localDispatch(fixtureScape());
    const { events, onEvent } = collector();
    const applier = createApplier({
      dispatch: local.dispatch,
      onEvent,
      allowedTools: CONNECT_TOOL_NAMES,
    });

    // The tool set is what a live generation offers the model; this is the second gate, for
    // a model that names a tool it was not given.
    applier.apply("ConnectObjects", { id: "r-new", from: "brief", to: "constraints" });
    applier.apply("CreateObject", { id: "sneaky", objectType: "note", title: "No", data: {} });

    expect(applier.applied()).toBe(1);
    expect(applier.skipped()).toBe(1);
    const skipped = events.find((e) => e.kind === "skipped");
    expect(skipped).toMatchObject({
      tool: "CreateObject",
      reason: "not available in this generation",
    });
    expect(local.get().objects["sneaky"]).toBeUndefined();
    expect(local.get().relationships["r-new"]).toBeDefined();
  });

  it("offers only the two relationship tools in connect mode", () => {
    expect(CONNECT_TOOL_NAMES).toEqual(["ConnectObjects", "DisconnectObjects"]);
    expect(CONNECT_TOOL_NAMES).not.toContain("CreateObject");
    expect(CONNECT_TOOL_NAMES).not.toContain("DeleteObject");
  });

  it("tells the model it cannot create anything", () => {
    const prompt = systemPrompt({ mode: "connect" });
    expect(prompt).toContain("You are not adding, editing or removing any of");
    expect(prompt).not.toContain("## The shape of each type's data");
  });
});

describe("generation scope", () => {
  it("keeps the selection out of the projection when the scope is the whole scape", () => {
    const scape = syntheticScape(40);
    const selected = [scape.objectOrder[7]!, scape.objectOrder[8]!];

    const whole = userPrompt("Do a thing", scape, { scope: "scape", selection: selected });
    const narrow = userPrompt("Do a thing", scape, { scope: "selection", selection: selected });

    expect(narrow.text).not.toBe(whole.text);
    expect(narrow.text).toContain("objects selected");
    expect(whole.text).not.toContain("objects selected");
  });

  it("names the selected ids so the model knows what it may touch", () => {
    const scape = fixtureScape();
    const prompt = userPrompt("Expand this", scape, {
      scope: "selection",
      selection: ["happy-path"],
    });
    expect(prompt.text).toContain("one object selected: happy-path");
    expect(prompt.text).toContain("Leave the rest of the scape alone.");
  });

  it("defaults to the whole scape when no scope is given", () => {
    const scape = fixtureScape();
    expect(userPrompt("x", scape, { selection: ["brief"] }).text).toBe(
      userPrompt("x", scape, { scope: "scape", selection: ["brief"] }).text,
    );
  });
});

describe("the starter steers the prompt", () => {
  it("carries the starter's description into the system prompt", () => {
    const withHint = systemPrompt({ starterHint: "This scape is a mind map." });
    expect(withHint).toContain("## What this scape is");
    expect(withHint).toContain("This scape is a mind map.");
    expect(systemPrompt()).not.toContain("## What this scape is");
  });
});
