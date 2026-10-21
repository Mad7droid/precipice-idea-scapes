import { describe, expect, it } from "vitest";
import { describeModel } from "./models";

describe("describeModel", () => {
  it("names the provider doing the work", () => {
    expect(describeModel("claude-sonnet-5")).toEqual({ provider: "Claude", model: "Sonnet 5" });
    expect(describeModel("chatgpt/gpt-5")).toEqual({ provider: "ChatGPT", model: "gpt-5" });
  });
});
