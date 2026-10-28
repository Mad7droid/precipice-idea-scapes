import { isTauri } from "@tauri-apps/api/core";

export const isDesktop = () => isTauri();

// The entry point imports this module first, so desktop-wide hooks (external links, quit
// flush) are installed at boot without touching the web bundle's startup path.
if (isTauri()) void import("@/desktop/boot").then(({ bootDesktop }) => bootDesktop());
