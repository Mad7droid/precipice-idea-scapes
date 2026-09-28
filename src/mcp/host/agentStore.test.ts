import { describe, expect, it } from "vitest";
import { agentLabel, agentLabels } from "./agentStore";

describe("agentLabel", () => {
  it("maps known client identifiers to product names", () => {
    expect(agentLabel("claude-ai")).toBe("Claude");
    expect(agentLabel("local-agent-mode-precipice")).toBe("Claude");
    expect(agentLabel("codex-mcp-client")).toBe("Codex");
    expect(agentLabel("openai-mcp")).toBe("ChatGPT");
  });

  it("makes unknown identifiers readable", () => {
    expect(agentLabel("acme-agent-mcp-client")).toBe("Acme Agent");
  });

  it("shows one entry per product", () => {
    expect(agentLabels(["claude-ai", "local-agent-mode-precipice", "codex-mcp-client"])).toEqual([
      "Claude",
      "Codex",
    ]);
  });
});
