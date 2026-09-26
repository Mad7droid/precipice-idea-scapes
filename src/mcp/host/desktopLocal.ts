import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { buildMcpServer } from "@/mcp/server";
import type { Grant } from "@/mcp/service";
import { agentHost } from "./host";
import { useAgentStore } from "./agentStore";

/**
 * The desktop app's built-in MCP server.
 *
 * Claude Desktop, Claude Code, Codex or Cursor launch `Precipice --mcp`, a tiny stdio pipe
 * that connects to the running app over a Unix socket (and launches the app if it is not
 * running). The Rust side relays each line to this webview, where the MCP server runs against
 * the same command service as the hosted connector. No port, no account, no pairing.
 */

export const LOCAL_MODE_KEY = "precipice.agent.localMode";

export function localApplyMode(): Grant["mode"] {
  try {
    return localStorage.getItem(LOCAL_MODE_KEY) === "review" ? "review" : "direct";
  } catch {
    return "direct";
  }
}

class TauriLineTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(
    readonly conn: number,
    private readonly sendLine: (conn: number, line: string) => Promise<void>,
  ) {}

  async start() {}

  async send(message: JSONRPCMessage) {
    await this.sendLine(this.conn, JSON.stringify(message));
  }

  async close() {
    this.onclose?.();
  }

  receive(line: string) {
    try {
      this.onmessage?.(JSON.parse(line) as JSONRPCMessage);
    } catch (error) {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

export async function startDesktopLocalMcp(): Promise<() => void> {
  const [{ listen }, { invoke }] = await Promise.all([
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/core"),
  ]);
  const sendLine = (conn: number, line: string) => invoke<void>("mcp_send", { conn, line });
  const connections = new Map<number, { transport: TauriLineTransport; client: () => string }>();
  const publish = () =>
    useAgentStore.getState().setLocalClients([...connections.values()].map((c) => c.client()));

  async function open(conn: number) {
    const transport = new TauriLineTransport(conn, sendLine);
    let clientName = "Local agent";
    const server = buildMcpServer((tool, args) => {
      const grant: Grant = {
        clientId: `local:${clientName}`,
        clientName,
        scapes: "all",
        mode: localApplyMode(),
        write: true,
      };
      return agentHost().execute({ id: `local_${conn}_${Date.now()}`, tool, args, grant });
    });
    server.server.oninitialized = () => {
      clientName = server.server.getClientVersion()?.name ?? clientName;
      publish();
    };
    connections.set(conn, { transport, client: () => clientName });
    await server.connect(transport);
    publish();
    return transport;
  }

  const pending = new Map<number, Promise<TauriLineTransport>>();
  const unlistenMessage = await listen<{ conn: number; line: string }>(
    "mcp://message",
    ({ payload }) => {
      let ready = pending.get(payload.conn);
      if (!ready) {
        ready = open(payload.conn);
        pending.set(payload.conn, ready);
      }
      void ready.then((transport) => transport.receive(payload.line));
    },
  );
  const unlistenClosed = await listen<{ conn: number }>("mcp://closed", ({ payload }) => {
    void pending.get(payload.conn)?.then((transport) => transport.close());
    pending.delete(payload.conn);
    connections.delete(payload.conn);
    publish();
  });
  // Tell the native side the webview is ready to receive; it buffers lines until then.
  await invoke("mcp_ready");

  return () => {
    unlistenMessage();
    unlistenClosed();
  };
}
