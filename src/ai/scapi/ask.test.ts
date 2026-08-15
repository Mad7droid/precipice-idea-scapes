import { describe, expect, it } from "vitest";
import { isMalformedToolHistory, isWebSearchUnavailable } from "./ask";
import { describeProviderError } from "@/ai/provider";

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
  it("recognises malformed internal tool history for a clean-context retry", () => {
    expect(
      isMalformedToolHistory(
        new Error("messages.11: code_execution tool use was found without a corresponding tool_result block"),
      ),
    ).toBe(true);
  });

  it("never exposes an unknown provider diagnostic to the user", () => {
    expect(describeProviderError(new Error("internal id secret_123 failed"))).toEqual({
      message: "Something went wrong",
      detail: "Scapi could not complete this response. Please try again.",
    });
  });
});
