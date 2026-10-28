/**
 * The Precipice MCP server definition, shared by every transport.
 *
 * The hosted Worker and the desktop app both build their server here, so tool names,
 * descriptions, schemas, annotations and prompts cannot drift between them. The server itself
 * holds no data: `call` forwards each tool call to wherever the person's library lives.
 *
 * Runtime-independent: no React, no Dexie, no editor registries.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FLOW_UI_HTML, FLOW_UI_MIME, FLOW_UI_URI } from "./flowUi";
import {
  annotations,
  descriptions,
  instructions,
  titles,
  toolSchemas,
  type Outcome,
  type ToolName,
} from "./contracts";

export const SERVER_NAME = "precipice";
export const SERVER_VERSION = "1.0.0";

export type ToolCaller = (tool: ToolName, args: Record<string, unknown>) => Promise<Outcome>;

/** The MCP Apps extension identifier a client advertises under `capabilities.extensions`. */
export const MCP_APPS_EXTENSION = "io.modelcontextprotocol/ui";
/** Tools only an MCP Apps view may call; never offered to a client that cannot render one. */
export const APP_ONLY_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  "confirm_flow",
  "share_flow_preview",
]);

export function advertisesMcpApps(capabilities: unknown): boolean {
  const extensions = (capabilities as { extensions?: Record<string, unknown> } | undefined)
    ?.extensions;
  return Boolean(extensions && typeof extensions[MCP_APPS_EXTENSION] === "object");
}

export type McpServerOptions = {
  /**
   * Whether this connection's client supports MCP Apps. Stateless transports (the hosted
   * Worker) build a fresh server per request and pass what initialize recorded; stateful ones
   * fall back to the capabilities negotiated on this server.
   */
  appsSupported?: () => boolean;
};

export function toolResult(outcome: Outcome) {
  const failed = outcome.status === "failed";
  const { _meta, ...summary } = outcome;
  const uiMeta = outcome.status === "preview" ? { ui: { resourceUri: FLOW_UI_URI } } : {};
  return {
    content: [{ type: "text" as const, text: JSON.stringify(summary) }],
    ...(_meta
      ? {
          structuredContent: summary,
          _meta: { ...uiMeta, ...(_meta as Record<string, unknown>) },
        }
      : {}),
    ...(failed ? { isError: true } : {}),
  };
}

const PROMPTS: {
  name: string;
  title: string;
  description: string;
  args: Record<string, z.ZodString>;
  text: (args: Record<string, string>) => string;
}[] = [
  {
    name: "build_user_journey",
    title: "Build a user journey",
    description: "Map a user journey onto a scape, with supporting notes and connected steps.",
    args: {
      scape_id: z.string().describe("Target scape ID"),
      goal: z.string().describe("What the journey is for"),
    },
    text: ({ scape_id, goal }: Record<string, string>) =>
      `In Precipice scape ${scape_id}, build a user journey for: ${goal}. Read the scape first with get_scape, call get_capabilities for data shapes, then draft a journey object with clear steps, supporting notes, and relationships. Call preview_flow with the batch so the person can inspect and confirm creation in chat.`,
  },
  {
    name: "critique_scape",
    title: "Critique a scape",
    description: "Review a scape for gaps, contradictions and unclear structure.",
    args: { scape_id: z.string().describe("Scape ID") },
    text: ({ scape_id }: Record<string, string>) =>
      `Read Precipice scape ${scape_id} (get_scape with include_objects, then get_objects as needed). Critique it: missing steps, contradictions, unclear titles, and disconnected ideas. Do not change anything; suggest concrete edits.`,
  },
  {
    name: "notes_to_wireframes",
    title: "Turn notes into wireframes",
    description: "Draft wireframes for the screens described in a scape's notes.",
    args: { scape_id: z.string().describe("Scape ID") },
    text: ({ scape_id }: Record<string, string>) =>
      `Read the notes in Precipice scape ${scape_id}. Draft a wireframe object for each screen they describe (use get_capabilities for the wireframe data shape) and connect each wireframe to the note it came from. Call preview_flow with the batch so the person can inspect and confirm creation in chat.`,
  },
];

export function buildMcpServer(call: ToolCaller, options: McpServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, title: "Precipice", version: SERVER_VERSION },
    { instructions },
  );
  server.registerResource(
    "flow-preview",
    FLOW_UI_URI,
    {
      title: "Precipice flow preview",
      mimeType: FLOW_UI_MIME,
    },
    async () => ({
      contents: [
        {
          uri: FLOW_UI_URI,
          mimeType: FLOW_UI_MIME,
          text: FLOW_UI_HTML,
          _meta: {
            ui: {
              csp: { connectDomains: [], resourceDomains: [] },
              prefersBorder: true,
              availableDisplayModes: ["inline", "fullscreen"],
            },
            "openai/widgetDescription":
              "Inspect flow blocks, journeys and screens, then explicitly create in Precipice or share a read-only iframe preview.",
            "openai/widgetPrefersBorder": true,
          },
        },
      ],
    }),
  );
  const appsSupported = () =>
    options.appsSupported?.() ?? advertisesMcpApps(server.server.getClientCapabilities());
  for (const name of Object.keys(toolSchemas) as ToolName[]) {
    const schema = toolSchemas[name] as unknown as z.ZodObject<z.ZodRawShape>;
    const registered = server.registerTool(
      name,
      {
        title: titles[name],
        description: descriptions[name],
        inputSchema: schema.shape,
        annotations: { title: titles[name], ...annotations(name) },
        ...(name === "preview_flow"
          ? {
              _meta: {
                ui: { resourceUri: FLOW_UI_URI },
                "openai/outputTemplate": FLOW_UI_URI,
                "openai/toolInvocation/invoking": "Preparing flow preview",
                "openai/toolInvocation/invoked": "Flow ready to review",
              },
            }
          : {}),
        ...(["confirm_flow", "share_flow_preview"].includes(name)
          ? {
              _meta: {
                ui: { visibility: ["app"] },
                "openai/visibility": "private",
                "openai/widgetAccessible": true,
              },
            }
          : {}),
        ...(name === "get_operation"
          ? {
              _meta: {
                ui: { visibility: ["model", "app"] },
                "openai/widgetAccessible": true,
              },
            }
          : {}),
      },
      async (args: Record<string, unknown>) => toolResult(await call(name, args ?? {})),
    );
    // The SDK omits disabled tools from tools/list and rejects calls to them, so deriving
    // `enabled` from the client's capabilities hides app-only confirmation tools from clients
    // without MCP Apps and refuses them if called anyway.
    if (APP_ONLY_TOOLS.has(name))
      Object.defineProperty(registered, "enabled", {
        get: appsSupported,
        set: () => undefined,
        configurable: true,
      });
  }
  for (const prompt of PROMPTS) {
    server.registerPrompt(
      prompt.name,
      { title: prompt.title, description: prompt.description, argsSchema: prompt.args },
      (args: Record<string, string>) => ({
        messages: [{ role: "user", content: { type: "text", text: prompt.text(args) } }],
      }),
    );
  }
  return server;
}
