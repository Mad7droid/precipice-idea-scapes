/** Build-time metadata only: no library reads, tool execution, or GUI startup. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import { buildMcpServer } from "./server";

export async function desktopDiscovery() {
  // Offline metadata cannot know the eventual client's capabilities, so it lists the
  // app-only confirmation tools; the live server still hides and refuses them per client.
  const server = buildMcpServer(
    async () => {
      throw new Error("Discovery must never execute a tool");
    },
    { appsSupported: () => true },
  );
  const client = new Client({ name: "desktop-discovery-build", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(a), client.connect(b)]);
    return {
      protocols: SUPPORTED_PROTOCOL_VERSIONS,
      initialize: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: client.getServerCapabilities(),
        serverInfo: client.getServerVersion(),
        instructions: client.getInstructions(),
      },
      "tools/list": await client.listTools(),
      "prompts/list": await client.listPrompts(),
      "resources/list": await client.listResources(),
      "resources/templates/list": await client.listResourceTemplates(),
    };
  } finally {
    await client.close();
    await server.close();
  }
}
