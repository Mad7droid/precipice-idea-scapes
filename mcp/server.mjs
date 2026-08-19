#!/usr/bin/env node

/**
 * The local Precipice MCP bridge.
 *
 * This process has two deliberately separate transports:
 *
 * - stdio is how an MCP host such as Claude Desktop talks to it;
 * - a loopback-only HTTP bridge is how an already-open Precipice tab shares the current scape
 *   and receives proposed action batches.
 *
 * Nothing is written to disk, and the process never sees an Anthropic API key. A short pairing
 * code is the capability that binds one browser tab to one local MCP process.
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const DEFAULT_PORT = 38383;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const PAIRING_CODE = /^[A-HJ-NP-Z2-9]{8}$/;

const noteData = z.object({ body: z.string() });
const journeyData = z.object({
  steps: z.array(z.object({ id: z.string().min(1), label: z.string(), detail: z.string().optional() })),
});
const wireframeData = z.object({
  primitives: z.array(
    z.object({
      id: z.string().min(1),
      kind: z.enum(["section", "heading", "text", "box", "image", "avatar", "input", "button", "checkbox", "toggle", "badge", "list", "divider"]),
      label: z.string().optional(),
      span: z.number().int().min(1).max(12),
      align: z.enum(["start", "center", "end"]).optional(),
      size: z.enum(["sm", "md", "lg"]).optional(),
    }),
  ),
  columns: z.union([z.literal(4), z.literal(6), z.literal(12)]).optional(),
});
const createObject = z.union([
  z.object({ type: z.literal("CreateObject"), id: z.string().min(1), objectType: z.literal("note"), title: z.string(), data: noteData }),
  z.object({ type: z.literal("CreateObject"), id: z.string().min(1), objectType: z.literal("journey"), title: z.string(), data: journeyData }),
  z.object({ type: z.literal("CreateObject"), id: z.string().min(1), objectType: z.literal("wireframe"), title: z.string(), data: wireframeData }),
  z.object({ type: z.literal("CreateObject"), id: z.string().min(1), objectType: z.literal("scape"), title: z.string(), data: noteData }),
]);
const actionInput = z.union([
  createObject,
  z.object({ type: z.literal("UpdateObject"), id: z.string().min(1), patch: z.object({ title: z.string().optional(), data: z.record(z.string(), z.unknown()).optional() }) }),
  z.object({ type: z.literal("DeleteObject"), id: z.string().min(1) }),
  z.object({ type: z.literal("ConnectObjects"), id: z.string().min(1), from: z.string().min(1), to: z.string().min(1), label: z.string().optional() }),
  z.object({ type: z.literal("DisconnectObjects"), id: z.string().min(1) }),
  z.object({ type: z.literal("RenameScape"), name: z.string().min(1) }),
]);
const scapeInput = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().max(200),
    objects: z.record(z.string(), z.unknown()),
    objectOrder: z.array(z.string()).max(500),
    relationships: z.record(z.string(), z.unknown()),
  })
  .passthrough();

function text(value) {
  return { content: [{ type: "text", text: value }] };
}

function originAllowed(origin) {
  if (!origin) return true;
  return (
    origin === "https://precipice.pages.dev" ||
    /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin)
  );
}

function response(res, status, body, origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
    // Required by Chromium when an HTTPS page talks to a loopback service.
    headers["Access-Control-Allow-Private-Network"] = "true";
  }
  res.writeHead(status, headers);
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on("data", (part) => {
      size += part.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("too_large"));
        req.destroy();
      } else {
        parts.push(part);
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(parts).toString("utf8")));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function summarizeScape(scape) {
  const objects = scape.objectOrder
    .map((id) => scape.objects[id])
    .filter(Boolean);
  const relationships = Object.values(scape.relationships);
  return {
    id: scape.id,
    name: scape.name,
    objects: objects.length,
    relationships: relationships.length,
    types: Object.fromEntries(
      objects.reduce((counts, object) => {
        counts.set(object.type, (counts.get(object.type) ?? 0) + 1);
        return counts;
      }, new Map()),
    ),
  };
}

function objectText(object) {
  return {
    id: object.id,
    type: object.type,
    title: object.title,
    data: object.data,
    connections: [],
  };
}

/**
 * Extracted from process startup so the loopback protocol can be tested without stdio.
 */
export function createBridge({ port = DEFAULT_PORT } = {}) {
  const sessions = new Map();

  const requireSession = (req, res, sessionId, origin) => {
    const session = sessions.get(sessionId);
    const code = req.headers["x-precipice-bridge-code"];
    if (!session || typeof code !== "string" || code !== session.code) {
      response(res, 401, { error: "unauthorized" }, origin);
      return null;
    }
    return session;
  };

  const enqueue = (sessionId, actions) => {
    const session = sessions.get(sessionId);
    if (!session) throw new Error("No paired Precipice scape is available.");
    const id = `cmd_${randomUUID()}`;
    return new Promise((resolve) => {
      const command = { id, actions, resolve, state: "queued", timer: null };
      command.timer = setTimeout(() => {
        session.commands = session.commands.filter((item) => item !== command);
        resolve({ status: "timed_out" });
      }, 15_000);
      session.commands.push(command);
    });
  };

  const http = createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (!originAllowed(origin)) return response(res, 403, { error: "origin_not_allowed" });
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": origin ?? "null",
        "Access-Control-Allow-Headers": "Content-Type, X-Precipice-Bridge-Code",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Private-Network": "true",
        Vary: "Origin",
        "Access-Control-Max-Age": "600",
      });
      return res.end();
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (req.method === "GET" && url.pathname === "/bridge/health") {
        return response(res, 200, { ok: true }, origin);
      }

      if (req.method === "POST" && url.pathname === "/bridge/sessions") {
        const body = await readJson(req);
        const code = req.headers["x-precipice-bridge-code"];
        const parsed = scapeInput.safeParse(body?.scape);
        if (typeof code !== "string" || !PAIRING_CODE.test(code) || !parsed.success) {
          return response(res, 400, { error: "invalid_session" }, origin);
        }
        for (const [id, session] of sessions) {
          if (session.code === code) sessions.delete(id);
        }
        const id = `scape_${randomUUID()}`;
        sessions.set(id, { id, code, scape: parsed.data, commands: [] });
        return response(res, 201, { sessionId: id }, origin);
      }

      const match = url.pathname.match(/^\/bridge\/sessions\/(scape_[\w-]+)(?:\/(scape|commands|disconnect))?$/);
      const commandMatch = url.pathname.match(/^\/bridge\/sessions\/(scape_[\w-]+)\/commands\/(cmd_[\w-]+)$/);
      const matchedSessionId = match?.[1] ?? commandMatch?.[1];
      if (!matchedSessionId) return response(res, 404, { error: "not_found" }, origin);
      const sessionId = matchedSessionId;
      const action = match?.[2];
      const session = requireSession(req, res, sessionId, origin);
      if (!session) return;

      if (req.method === "POST" && commandMatch) {
        const [, , commandId] = commandMatch;
        const command = session.commands.find((item) => item.id === commandId);
        if (!command) return response(res, 404, { error: "not_found" }, origin);
        const body = await readJson(req);
        const parsed = scapeInput.safeParse(body?.scape);
        if (parsed.success) session.scape = parsed.data;
        const status = body?.status === "applied" || body?.status === "rejected" ? body.status : "awaiting_review";
        if (status === "awaiting_review") {
          command.state = "reviewing";
          clearTimeout(command.timer);
          command.resolve({ status, ...body });
        } else {
          clearTimeout(command.timer);
          session.commands = session.commands.filter((item) => item !== command);
          command.resolve({ status, ...body });
        }
        return response(res, 204, undefined, origin);
      }

      if (req.method === "DELETE" && action === "disconnect") {
        sessions.delete(sessionId);
        return response(res, 204, undefined, origin);
      }

      if (req.method === "PUT" && action === "scape") {
        const body = await readJson(req);
        const parsed = scapeInput.safeParse(body?.scape);
        if (!parsed.success) return response(res, 400, { error: "invalid_scape" }, origin);
        session.scape = parsed.data;
        return response(res, 204, undefined, origin);
      }

      if (req.method === "GET" && action === "commands") {
        const commands = session.commands
          .filter((command) => command.state === "queued")
          .map(({ id, actions }) => ({ id, actions }));
        return response(res, 200, { commands }, origin);
      }

      return response(res, 404, { error: "not_found" }, origin);
    } catch (error) {
      const code = error instanceof Error ? error.message : "server_error";
      return response(res, code === "too_large" ? 413 : 400, { error: code }, origin);
    }
  });

  return {
    async listen() {
      await new Promise((resolve, reject) => {
        http.once("error", reject);
        http.listen(port, "127.0.0.1", () => {
          http.off("error", reject);
          resolve();
        });
      });
      const address = http.address();
      return typeof address === "object" && address ? address.port : port;
    },
    close: () => new Promise((resolve, reject) => http.close((error) => (error ? reject(error) : resolve()))),
    sessions,
    enqueue,
  };
}

function connectedScapes(bridge) {
  return [...bridge.sessions.values()].map((session) => ({
    sessionId: session.id,
    ...summarizeScape(session.scape),
  }));
}

function buildMcpServer(bridge) {
  const server = new McpServer({ name: "precipice", version: "0.1.0" });
  let activeSessionId = null;

  const active = () => (activeSessionId ? bridge.sessions.get(activeSessionId) : null);
  const noActive = () => text("No Precipice scape is paired. In Precipice Settings → Claude MCP, connect the open scape and use the displayed eight-character pairing code.");

  server.registerTool(
    "list_paired_scapes",
    {
      title: "List paired Precipice scapes",
      description: "List the Precipice browser tabs currently paired to this local MCP server.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => text(JSON.stringify(connectedScapes(bridge), null, 2)),
  );

  server.registerTool(
    "pair_with_precipice",
    {
      title: "Pair with an open Precipice scape",
      description: "Select an open Precipice scape using the eight-character code shown in its Settings → Claude MCP panel.",
      inputSchema: { code: z.string().regex(PAIRING_CODE) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ code }) => {
      const session = [...bridge.sessions.values()].find((item) => item.code === code);
      if (!session) return text("That pairing code is not active. Open the scape in Precipice, start the local bridge, and try again.");
      activeSessionId = session.id;
      return text(`Paired with “${session.scape.name}” (${session.scape.objectOrder.length} objects).`);
    },
  );

  server.registerTool(
    "read_active_scape",
    {
      title: "Read the active Precipice scape",
      description: "Read the full structured content and relationships of the paired scape. Use search_active_scape first for a large scape.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const session = active();
      return session ? text(JSON.stringify(session.scape, null, 2)) : noActive();
    },
  );

  server.registerTool(
    "search_active_scape",
    {
      title: "Search the active Precipice scape",
      description: "Find objects by id, title, type, or content in the paired scape.",
      inputSchema: { query: z.string().min(1).max(200) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query }) => {
      const session = active();
      if (!session) return noActive();
      const needle = query.toLowerCase();
      const hits = session.scape.objectOrder
        .map((id) => session.scape.objects[id])
        .filter(Boolean)
        .filter((object) => JSON.stringify(object).toLowerCase().includes(needle))
        .slice(0, 20)
        .map((object) => ({ id: object.id, type: object.type, title: object.title }));
      return text(JSON.stringify(hits, null, 2));
    },
  );

  server.registerTool(
    "read_active_objects",
    {
      title: "Read selected objects from the active scape",
      description: "Read complete object data by id from the paired scape.",
      inputSchema: { ids: z.array(z.string().min(1)).min(1).max(20) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ ids }) => {
      const session = active();
      if (!session) return noActive();
      const objects = ids
        .map((id) => session.scape.objects[id])
        .filter(Boolean)
        .map((object) => objectText(object));
      return text(JSON.stringify(objects, null, 2));
    },
  );

  server.registerTool(
    "apply_to_active_scape",
    {
      title: "Apply a flow to the active Precipice scape",
      description:
        "Send a batch of content actions to the paired Precipice tab. Do not use coordinates. " +
        "The tab validates every action, lets the user review it unless direct apply is enabled, and lays out new objects itself.",
      inputSchema: { actions: z.array(actionInput).min(1).max(100) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ actions }) => {
      const session = active();
      if (!session) return noActive();
      const outcome = await bridge.enqueue(session.id, actions);
      if (outcome.status === "applied") {
        return text(`Precipice applied ${outcome.applied ?? 0} action(s) and skipped ${outcome.skipped ?? 0}.`);
      }
      if (outcome.status === "awaiting_review") {
        return text("The action batch is waiting for approval in Precipice. It has not changed the scape yet.");
      }
      return text("Precipice did not respond in time. Check that the paired tab is still open.");
    },
  );

  return server;
}

export async function start({ port = DEFAULT_PORT } = {}) {
  const bridge = createBridge({ port });
  const boundPort = await bridge.listen();
  const server = buildMcpServer(bridge);
  await server.connect(new StdioServerTransport());
  console.error(`Precipice MCP bridge listening on http://127.0.0.1:${boundPort}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
