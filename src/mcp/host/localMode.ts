import type { Grant } from "@/mcp/service";

/*
 * The desktop MCP's apply-mode preference, kept apart from `desktopLocal.ts` so the settings
 * panel can read it without pulling the MCP SDK into the startup bundle.
 */

export const LOCAL_MODE_KEY = "precipice.agent.localMode";

export function localApplyMode(clientName?: string): Grant["mode"] {
  try {
    if (clientName && localStorage.getItem(`precipice.agent.trust.${clientName}`) === "direct")
      return "direct";
    return localStorage.getItem(LOCAL_MODE_KEY) === "direct" ? "direct" : "review";
  } catch {
    return "review";
  }
}
