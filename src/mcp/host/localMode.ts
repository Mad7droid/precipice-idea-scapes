import type { Grant } from "@/mcp/service";

/*
 * The desktop MCP's apply-mode preference, kept apart from `desktopLocal.ts` so the settings
 * panel can read it without pulling the MCP SDK into the startup bundle.
 */

export const LOCAL_MODE_KEY = "precipice.agent.localMode";

/**
 * Per-agent trust is keyed on a verified install (the token `mcp_install_client` wrote into
 * that client's config), never on the agent-supplied `clientInfo.name`. Unverified local
 * agents always follow the global preference, which defaults to review.
 */
export function localTrustKey(install: string) {
  return `precipice.agent.trust.install:${install}`;
}

export function localApplyMode(install?: string | null): Grant["mode"] {
  try {
    if (install && localStorage.getItem(localTrustKey(install)) === "direct") return "direct";
    return localStorage.getItem(LOCAL_MODE_KEY) === "direct" ? "direct" : "review";
  } catch {
    return "review";
  }
}

/**
 * Local grants use `local:<conn>:<install|unverified>`: previews and receipts bind to the
 * live connection, and the trusted install (if any) is recoverable for "Always apply".
 */
export function localClientId(conn: number, install?: string | null) {
  return `local:${conn}:${install ?? "unverified"}`;
}

export function installFromClientId(clientId: string): string | null {
  const match = /^local:\d+:(.+)$/.exec(clientId);
  return match && match[1] !== "unverified" ? match[1] : null;
}
