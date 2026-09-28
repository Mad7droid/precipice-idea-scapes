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

export function toolResult(outcome: Outcome) {
  const failed = outcome.status === "failed";
  return {
    content: [{ type: "text" as const, text: JSON.stringify(outcome, null, 2) }],
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
      `In Precipice scape ${scape_id}, build a user journey for: ${goal}. Read the scape first with get_scape, call get_capabilities for data shapes, then add a journey object with clear steps, a few supporting notes, and relationships connecting them in one apply_changes batch.`,
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
      `Read the notes in Precipice scape ${scape_id}. Draft a wireframe object for each screen they describe (use get_capabilities for the wireframe data shape) and connect each wireframe to the note it came from, in one apply_changes batch.`,
  },
];

export function buildMcpServer(call: ToolCaller): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, title: "Precipice", version: SERVER_VERSION },
    { instructions },
  );
  for (const name of Object.keys(toolSchemas) as ToolName[]) {
    const schema = toolSchemas[name] as unknown as z.ZodObject<z.ZodRawShape>;
    server.registerTool(
      name,
      {
        title: titles[name],
        description: descriptions[name],
        inputSchema: schema.shape,
        annotations: { title: titles[name], ...annotations(name) },
      },
      async (args: Record<string, unknown>) => toolResult(await call(name, args ?? {})),
    );
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
