import { afterEach, describe, expect, it } from "vitest";
import {
  LOCAL_MODE_KEY,
  installFromClientId,
  localApplyMode,
  localClientId,
  localTrustKey,
} from "@/mcp/host/localMode";

describe("local agent trust", () => {
  afterEach(() => localStorage.clear());

  it("ignores trust stored under a self-reported client name", () => {
    localStorage.setItem("precipice.agent.trust.claude-ai", "direct");
    expect(localApplyMode(null)).toBe("review");
  });

  it("trusts only a verified install", () => {
    localStorage.setItem(localTrustKey("cursor"), "direct");
    expect(localApplyMode("cursor")).toBe("direct");
    expect(localApplyMode("codex")).toBe("review");
    localStorage.setItem(LOCAL_MODE_KEY, "direct");
    expect(localApplyMode(null)).toBe("direct");
  });

  it("binds grants to the connection and recovers only verified installs", () => {
    expect(localClientId(3, "cursor")).toBe("local:3:cursor");
    expect(installFromClientId(localClientId(3, "cursor"))).toBe("cursor");
    expect(installFromClientId(localClientId(4, null))).toBeNull();
    expect(installFromClientId("local:claude-ai")).toBeNull();
  });
});
