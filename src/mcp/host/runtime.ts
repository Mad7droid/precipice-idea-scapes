import { useEffect } from "react";
import { isDesktop } from "@/desktop/runtime";
import { restorePendingReviews } from "./host";
import { startRelay, type RelayController } from "./relay";
import { loadHostCredential } from "./credential";
import { listenDesktopSignIn } from "./desktopAuth";

/**
 * Starts every agent transport this app instance offers, once, at launch. Nothing here asks
 * the person to do anything: the relay connects by itself whenever they have a connected
 * agent, and the desktop app's local server is always listening.
 */
let relay: RelayController | null = null;

/** Re-check the relay now — after a new agent is approved or one is removed. */
export function refreshAgentRelay(): void {
  relay?.refresh();
  // Wake the tab holding the relay lock after consent completes in another tab.
  try {
    localStorage.setItem("precipice.agent.grants", String(Date.now()));
  } catch {
    /* storage disabled */
  }
}

export function useAgentRuntime(): void {
  useEffect(() => {
    const desktop = isDesktop();
    const controller = startRelay(desktop ? "desktop" : "web");
    relay = controller;
    void restorePendingReviews();
    let stopAuth: (() => void) | undefined;
    let stopLocal: (() => void) | undefined;
    let cancelled = false;
    if (desktop) {
      void loadHostCredential()
        .then(() => {
          if (!cancelled) controller.refresh();
        })
        .catch(() => undefined);
      void listenDesktopSignIn(() => controller.refresh()).then((stop) =>
        cancelled ? stop() : (stopAuth = stop),
      );
    }
    // Loaded on demand: the MCP SDK is large and only the desktop app runs a local server.
    if (desktop)
      void import("./desktopLocal")
        .then(({ startDesktopLocalMcp }) => startDesktopLocalMcp())
        .then((stop) => (cancelled ? stop() : (stopLocal = stop)))
        .catch(() => undefined);
    return () => {
      cancelled = true;
      controller.stop();
      if (relay === controller) relay = null;
      stopLocal?.();
      stopAuth?.();
    };
  }, []);
}
