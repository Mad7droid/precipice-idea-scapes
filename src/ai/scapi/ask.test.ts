import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamText } from "ai";
import { ask, isMalformedToolHistory, isWebSearchUnavailable } from "./ask";
import { describeProviderError } from "@/ai/provider";
import { emptyScape } from "@/core/fixtures";
import type { AskEvent, ModelTurn } from "./types";

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  streamText: vi.fn(),
}));

describe("request recovery", () => {
  beforeEach(() => vi.mocked(streamText).mockReset());

  function stream(parts: unknown[]) {
    return {
      fullStream: (async function* () {
        for (const part of parts) yield part;
      })(),
      response: Promise.resolve({ messages: [{ role: "assistant", content: "Answer" }] }),
    } as unknown as ReturnType<typeof streamText>;
  }

  async function send(history: ModelTurn[] = []) {
    const events: AskEvent[] = [];
    await ask({
      question: "simplify",
      scape: emptyScape("scp_recovery"),
      history,
      apiKey: "test-key",
      modelId: "claude-sonnet-5",
      onEvent: (event) => events.push(event),
    });
    return events;
  }

  it("retries a plain SSE search rejection without search and completes the answer", async () => {
    vi.mocked(streamText)
      .mockReturnValueOnce(
        stream([
          {
            type: "error",
            error: {
              type: "invalid_request_error",
              message: "web_search is disabled",
            },
          },
        ]),
      )
      .mockReturnValueOnce(stream([{ type: "text-delta", text: "Answer" }]));
    const events = await send();
    expect(streamText).toHaveBeenCalledTimes(2);
    const [first, second] = vi.mocked(streamText).mock.calls;
    expect(first[0].tools?.web_search).toMatchObject({ id: "anthropic.web_search_20250305" });
    expect(second[0].tools).not.toHaveProperty("web_search");
    expect(events).toContainEqual({ kind: "search-unavailable" });
    expect(events).toContainEqual({ kind: "text", text: "Answer" });
    expect(events.some((event) => event.kind === "error")).toBe(false);
    expect(events.filter((event) => event.kind === "done")).toHaveLength(1);
  });

  it("clears rejected tool history, then recovers search without looping", async () => {
    const malformed = {
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "code_execution tool use without a corresponding tool_result",
      },
    };
    vi.mocked(streamText)
      .mockReturnValueOnce(stream([malformed]))
      .mockReturnValueOnce(
        stream([
          {
            type: "error",
            error: {
              type: "invalid_request_error",
              message: "web_search is disabled",
            },
          },
        ]),
      )
      .mockReturnValueOnce(stream([malformed]));
    const events = await send([
      {
        user: { role: "user", content: "Previous question" },
        response: [{ role: "assistant", content: "Previous answer" }],
      },
    ]);
    expect(streamText).toHaveBeenCalledTimes(3);
    expect(vi.mocked(streamText).mock.calls[1][0].messages).toHaveLength(2);
    expect(events.filter((event) => event.kind === "history-reset")).toHaveLength(1);
    expect(events.filter((event) => event.kind === "error")).toHaveLength(1);
    expect(events.filter((event) => event.kind === "done")).toHaveLength(1);
  });

  it("does not append a retried answer after partial output", async () => {
    vi.mocked(streamText).mockReturnValueOnce(
      stream([
        { type: "text-delta", text: "Partial" },
        {
          type: "error",
          error: { type: "invalid_request_error", message: "web_search unavailable" },
        },
      ]),
    );
    const events = await send();
    expect(streamText).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({ kind: "done", turn: null });
  });
});

describe("web search fallback", () => {
  it.each([
    "Web search is not enabled for this organization.",
    "The web_search tool is unavailable for this API key.",
    "Search permission was denied.",
  ])("recognises unavailable search access: %s", (message) => {
    expect(isWebSearchUnavailable(new Error(message))).toBe(true);
  });

  it.each(["Rate limit exceeded", "Invalid API key", "The model is overloaded"])(
    "does not mistake unrelated failures for a search setting: %s",
    (message) => {
      expect(isWebSearchUnavailable(new Error(message))).toBe(false);
    },
  );
});

describe("safe error presentation", () => {
  it("distinguishes the monthly API usage cap from credits and transient rate limits", () => {
    const message =
      "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.";
    const expected = {
      message: "Anthropic API usage limit reached",
      detail:
        "Increase the API account’s usage limit in Anthropic Console, or wait for it to reset. Access resets 2026-11-01 at 00:00 UTC.",
    };
    expect(describeProviderError(Object.assign(new Error(message), { statusCode: 400 }))).toEqual(
      expected,
    );
    expect(describeProviderError({ type: "invalid_request_error", message })).toEqual(expected);
    expect(
      describeProviderError({
        type: "invalid_request_error",
        message: "Monthly limit reached: secret content",
      }).detail,
    ).not.toContain("secret");
  });
  it.each([
    [413, "Request too large", "This conversation is too large"],
    [400, "Your credit balance is too low", "Anthropic credits unavailable"],
    [403, "Forbidden", "Scapi access was denied"],
    [500, "Internal error", "Anthropic is temporarily unavailable"],
  ])("explains HTTP %s failures", (statusCode, message, expected) => {
    expect(describeProviderError(Object.assign(new Error(message), { statusCode })).message).toBe(
      expected,
    );
  });
  it("recognises malformed internal tool history for a clean-context retry", () => {
    expect(
      isMalformedToolHistory(
        new Error(
          "messages.11: code_execution tool use was found without a corresponding tool_result block",
        ),
      ),
    ).toBe(true);
  });

  it("classifies failures that arrive mid-stream as plain provider payloads", () => {
    expect(describeProviderError({ type: "overloaded_error", message: "Overloaded" }).message).toBe(
      "Scapi is temporarily busy",
    );
    expect(
      describeProviderError({
        type: "error",
        error: { type: "rate_limit_error", message: "Slow down" },
      }).message,
    ).toBe("Scapi is temporarily busy");
    expect(
      isWebSearchUnavailable({ type: "invalid_request_error", message: "web_search is disabled" }),
    ).toBe(true);
  });

  it("gives an unknown failure a safe reference, never the provider's own text", () => {
    const described = describeProviderError({
      type: "invalid_request_error",
      message: "messages.3: secret request content",
    });
    expect(described.message).toBe("Something went wrong");
    expect(described.detail).toContain("Reference: invalid_request_error.");
    expect(described.detail).not.toContain("secret");

    const http = Object.assign(new Error("bad secret"), { statusCode: 400 });
    expect(describeProviderError(http).detail).toContain("Reference: HTTP 400.");
  });

  it("never exposes an unknown provider diagnostic to the user", () => {
    expect(describeProviderError(new Error("internal id secret_123 failed"))).toEqual({
      message: "Something went wrong",
      detail: "Scapi could not complete this response. Please try again.",
    });
  });
});
