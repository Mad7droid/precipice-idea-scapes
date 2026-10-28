import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { desktopDiscovery } from "./desktopDiscovery";

it("ships the same desktop discovery metadata as the live server without accessing a library", async () => {
  const bundled = JSON.parse(readFileSync("src-tauri/src/mcp-discovery.json", "utf8"));
  expect(bundled).toEqual(await desktopDiscovery());
});
