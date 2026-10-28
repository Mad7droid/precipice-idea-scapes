import { writeFileSync } from "node:fs";
import { desktopDiscovery } from "../src/mcp/desktopDiscovery";

writeFileSync(
  new URL("../src-tauri/src/mcp-discovery.json", import.meta.url),
  JSON.stringify(await desktopDiscovery(), null, 2) + "\n",
);
