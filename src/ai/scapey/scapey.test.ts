import { describe, expect, it, vi } from "vitest";
import { emptyScape, fixtureScape, syntheticScape } from "@/core/fixtures";
import { CHAT_BUDGET_TOKENS, estimateTokens, projectScapeForChat } from "@/ai/context";
import { applyAskEvent, startTurn } from "./reducer";
import { scapeyTools } from "./scapeyTools";
import { questionBlock, scapeContextBlock, scapeySystemPrompt } from "./scapeyPrompt";

const scape = fixtureScape();

describe("projectScapeForChat", () => {
  it("gives every object a body at fixture size", () => {
    const projection = projectScapeForChat(scape);
    expect(projection.omitted).toBe(0);
    for (const id of scape.objectOrder) {
      expect(projection.text).toContain(id);
    }
  });

  it("includes relationships as an adjacency list", () => {
    const projection = projectScapeForChat(scape);
    const relationship = Object.values(scape.relationships)[0];
    expect(projection.text).toContain(`${relationship.from} -> ${relationship.to}`);
  });

  it("stays inside its budget and reports what it dropped", () => {
    const big = syntheticScape(400);
    const projection = projectScapeForChat(big);

    expect(projection.estimatedTokens).toBeLessThanOrEqual(CHAT_BUDGET_TOKENS);
    expect(projection.omitted).toBeGreaterThan(0);
  });

  it("keeps both ends when it truncates", () => {
    const big = syntheticScape(400);
    const projection = projectScapeForChat(big);

    expect(projection.text).toContain(big.objectOrder[0]);
    expect(projection.text).toContain(big.objectOrder[big.objectOrder.length - 1]);
  });

  it("survives an empty scape", () => {
    const projection = projectScapeForChat(emptyScape("scp_empty"));
    expect(projection.omitted).toBe(0);
    expect(estimateTokens(projection.text)).toBeGreaterThan(0);
  });
});

describe("prompt", () => {
  it("frames canvas data as untrusted", () => {
    expect(scapeySystemPrompt()).toMatch(/untrusted/i);
  });

  it("tells the model it cannot change the document", () => {
    expect(scapeySystemPrompt()).toMatch(/cannot change it/i);
  });

  it("marks the scape block as authoritative over older turns", () => {
    expect(scapeContextBlock(scape)).toMatch(/this block is the one that is correct/i);
  });

  it("names the selection in the uncached half, not the cached block", () => {
    const id = scape.objectOrder[0];
    const question = questionBlock("What is this?", [id], scape);

    expect(question).toContain(id);
    expect(scapeContextBlock(scape)).not.toContain("has these objects selected");
  });

  it("ignores a selection of objects that no longer exist", () => {
    const question = questionBlock("What is this?", ["ghost-object"], scape);
    expect(question).not.toContain("ghost-object");
    expect(question).toContain("<question>");
  });

  it("adds an advisory format hint without rewriting the user's question", () => {
    const question = questionBlock("Summarise this scape", [], scape);
    expect(question).toMatch(/response-mode hint/i);
    expect(question).toContain("<question>\nSummarise this scape\n</question>");
  });
});

describe("tools", () => {
  const tools = scapeyTools({ scape, onActivity: () => {} });

  it("offer nothing that mutates", () => {
    // The guard on the one-writer rule. If someone adds a write tool to Scapey, this is the
    // test that has to fail — `applyAction` is the only path state changes through, and
    // Scapey reads the open web, so a tool here is a tool a hostile page can reach.
    const names = Object.keys(tools);
    expect(names.sort()).toEqual(["read_objects", "search_scape"]);

    const forbidden = /create|update|delete|connect|disconnect|rename|move|write|set/i;
    for (const name of names) expect(name).not.toMatch(forbidden);
  });

  it("search_scape finds objects by title and reports activity", () => {
    const onActivity = vi.fn();
    const searching = scapeyTools({ scape, onActivity });
    const target = scape.objects[scape.objectOrder[0]];

    return searching.search_scape.execute!({ query: target.title }, {} as never).then(
      (result: unknown) => {
        expect(String(result)).toContain(target.id);
        expect(onActivity).toHaveBeenCalledWith({
          kind: "reading-canvas",
          query: target.title,
        });
      },
    );
  });

  it("search_scape says so plainly when nothing matches", () =>
    tools.search_scape.execute!({ query: "zzzz-no-such-thing" }, {} as never).then(
      (result: unknown) => expect(String(result)).toMatch(/no objects match/i),
    ));

  it("read_objects returns full bodies", () => {
    const id = scape.objectOrder[0];
    return tools.read_objects.execute!({ ids: [id] }, {} as never).then((result: unknown) => {
      expect(String(result)).toContain(id);
      expect(String(result)).toContain(JSON.stringify(scape.objects[id].data).slice(0, 40));
    });
  });

  it("read_objects reports a missing id as information rather than failing", () =>
    tools.read_objects.execute!({ ids: ["not-a-real-id"] }, {} as never).then((result: unknown) =>
      expect(String(result)).toMatch(/no object with this id exists/i),
    ));
});

describe("stream reducer", () => {
  it("appends reasoning and body separately", () => {
    let turn = startTurn("Q");
    turn = applyAskEvent(turn, { kind: "reasoning", text: "thinking " });
    turn = applyAskEvent(turn, { kind: "reasoning", text: "more" });
    turn = applyAskEvent(turn, { kind: "text", text: "answer" });

    expect(turn.reasoning).toBe("thinking more");
    expect(turn.body).toBe("answer");
    expect(turn.status).toBe("streaming");
  });

  it("records activity in the order it happened", () => {
    let turn = startTurn("Q");
    turn = applyAskEvent(turn, { kind: "activity", event: { kind: "thinking" } });
    turn = applyAskEvent(turn, {
      kind: "activity",
      event: { kind: "reading-objects", ids: ["a", "b"] },
    });
    turn = applyAskEvent(turn, { kind: "activity", event: { kind: "writing" } });

    expect(turn.activity.map((a) => a.kind)).toEqual(["thinking", "reading-objects", "writing"]);
  });

  it("deduplicates sources by id", () => {
    const source = { id: "s1", url: "https://example.com", title: "Example" };
    let turn = startTurn("Q");
    turn = applyAskEvent(turn, { kind: "source", source });
    turn = applyAskEvent(turn, { kind: "source", source });

    expect(turn.sources).toHaveLength(1);
  });

  it("keeps the error status when done arrives after a failure", () => {
    let turn = startTurn("Q");
    turn = applyAskEvent(turn, { kind: "text", text: "half an answer" });
    turn = applyAskEvent(turn, { kind: "error", message: "Overloaded", detail: "Try again." });
    turn = applyAskEvent(turn, { kind: "done", turn: null });

    expect(turn.status).toBe("error");
    expect(turn.error?.message).toBe("Overloaded");
    // The partial answer is kept — it is real output, and hiding it explains nothing.
    expect(turn.body).toBe("half an answer");
  });

  it("marks a completed turn done", () => {
    let turn = startTurn("Q");
    turn = applyAskEvent(turn, { kind: "text", text: "answer" });
    turn = applyAskEvent(turn, {
      kind: "done",
      turn: { user: { role: "user", content: "Q" }, response: [] },
    });

    expect(turn.status).toBe("done");
  });
});
