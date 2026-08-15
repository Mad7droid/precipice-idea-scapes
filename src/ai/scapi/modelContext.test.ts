import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { fixtureScape } from "@/core/fixtures";
import { assembleMessages, HISTORY_TURNS } from "./ask";
import { applyAskEvent, isComplete, startTurn } from "./reducer";
import type { ModelTurn } from "./types";

/**
 * The history invariants. These are the tests that stop a plausible-looking refactor from
 * silently degrading every conversation past its first turn.
 */

const scape = fixtureScape();

/** A turn shaped like the provider's: assistant/tool messages only, no user message. */
function modelTurn(question: string, answer: string, extra: ModelMessage[] = []): ModelTurn {
  return {
    user: { role: "user", content: question },
    response: [{ role: "assistant", content: answer }, ...extra],
  };
}

function textOf(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
    .join(" ");
}

describe("conversational meaning", () => {
  it("carries the earlier question forward, not just the earlier answer", () => {
    // The bug this guards: `result.response.messages` is typed
    // `Array<AssistantModelMessage | ToolModelMessage>` — it never contains the user's
    // question. Appending it alone builds a history of answers to nothing, and by turn two
    // the model cannot answer "what did I just ask?".
    const history = [modelTurn("How many wireframes are there?", "Two.")];
    const messages = assembleMessages(scape, history, "What did I just ask?");

    const asked = messages.filter((m) => m.role === "user").map(textOf);
    expect(asked.some((text) => text.includes("How many wireframes are there?"))).toBe(true);
    expect(asked.some((text) => text.includes("What did I just ask?"))).toBe(true);
  });

  it("keeps question and answer adjacent and in order", () => {
    const history = [modelTurn("First question", "First answer")];
    const messages = assembleMessages(scape, history, "Second question");

    const roles = messages.map((m) => m.role);
    const q = messages.findIndex((m) => m.role === "user" && textOf(m).includes("First question"));
    const a = messages.findIndex(
      (m) => m.role === "assistant" && textOf(m).includes("First answer"),
    );

    expect(q).toBeGreaterThan(-1);
    expect(a).toBe(q + 1);
    expect(roles[roles.length - 1]).toBe("user");
  });

  it("puts the scape block first, so it is the cacheable prefix", () => {
    const messages = assembleMessages(scape, [], "Anything");
    const first = messages[0];

    expect(first.role).toBe("user");
    expect(textOf(first)).toContain("<canvas-data>");

    const parts = first.content;
    expect(Array.isArray(parts)).toBe(true);
    expect((parts as Array<{ providerOptions?: unknown }>)[0].providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
  });

  it("keeps the scape block byte-identical whether or not there is history", () => {
    // A block that changes shape once a conversation starts can never be a cache hit.
    const cold = textOf(assembleMessages(scape, [], "Q")[0]);
    const warm = textOf(assembleMessages(scape, [modelTurn("A", "B")], "Q")[0]);
    expect(warm).toBe(cold);
  });
});

describe("citation continuity", () => {
  it("passes provider tool messages back untouched, including opaque fields", () => {
    // `encryptedContent` is opaque to us and required for the model to keep citing sources it
    // already found. Anything that "cleans up" history before resending breaks research
    // threads in a way that is invisible until someone reads the citations.
    const toolMessage: ModelMessage = {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call_1",
          toolName: "web_search",
          output: {
            type: "json",
            value: [{ url: "https://example.com", title: "Example", encryptedContent: "OPAQUE" }],
          },
        },
      ],
    };

    const history = [modelTurn("Search something", "Found it.", [toolMessage])];
    const messages = assembleMessages(scape, history, "Follow up");

    expect(JSON.stringify(messages)).toContain("OPAQUE");
    expect(messages).toContainEqual(toolMessage);
  });
});

describe("atomicity", () => {
  it("trims whole turns from the front and never edits one", () => {
    const history = Array.from({ length: HISTORY_TURNS + 3 }, (_, i) =>
      modelTurn(`question ${i}`, `answer ${i}`),
    );
    const messages = assembleMessages(scape, history, "Now");
    const body = JSON.stringify(messages);

    // Oldest dropped, newest kept — and every kept turn keeps both halves.
    expect(body).not.toContain("question 0");
    expect(body).toContain(`question ${HISTORY_TURNS + 2}`);
    for (let i = 3; i < HISTORY_TURNS + 3; i++) {
      expect(body).toContain(`question ${i}`);
      expect(body).toContain(`answer ${i}`);
    }
  });

  it("treats a cancelled turn as incomplete, so it never enters history", () => {
    let turn = startTurn("Half a question");
    turn = applyAskEvent(turn, { kind: "text", text: "partial" });
    turn = applyAskEvent(turn, { kind: "done", turn: null });

    expect(turn.status).toBe("cancelled");
    expect(isComplete(turn)).toBe(false);
    // The partial answer stays on screen — it was real output.
    expect(turn.body).toBe("partial");
  });

  it("treats an errored turn as incomplete", () => {
    let turn = startTurn("Doomed");
    turn = applyAskEvent(turn, { kind: "error", message: "Rate limited", detail: "Wait." });
    turn = applyAskEvent(turn, { kind: "done", turn: null });

    expect(turn.status).toBe("error");
    expect(isComplete(turn)).toBe(false);
  });
});
