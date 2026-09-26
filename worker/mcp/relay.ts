import { DurableObject } from "cloudflare:workers";
import { LIMITS, failure, type Outcome } from "../../src/mcp/contracts";
import type { Envelope } from "../../src/mcp/contracts";

/**
 * One relay object per person. Their open Precipice tab (or desktop app) holds a hibernating
 * WebSocket here; the MCP Worker forwards each tool call and waits for the tab's answer.
 *
 * Idle costs nothing: the socket hibernates, pings are answered by the runtime without waking
 * the object, and nothing runs on a timer. Private scape content passes through in memory and
 * is never stored here.
 */
type Pending = { resolve: (outcome: Outcome) => void; timer: ReturnType<typeof setTimeout> };

const UNAVAILABLE =
  "Precipice isn't open right now. Ask the person to open Precipice (the web app or the desktop app) and then retry. Their scapes live on their device, so Precipice must be running to reach them.";

export class McpRelay extends DurableObject {
  private pending = new Map<string, Pending>();
  private minute = { start: 0, calls: 0 };

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      // Newest tab wins: older sockets are closed so calls have one unambiguous destination.
      for (const old of this.ctx.getWebSockets("tab")) old.close(4000, "replaced");
      this.ctx.acceptWebSocket(server, ["tab"]);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (request.method === "POST" && url.pathname === "/call") {
      const envelope = (await request.json()) as Envelope;
      return Response.json(await this.call(envelope));
    }
    if (request.method === "GET" && url.pathname === "/status") {
      return Response.json({ connected: this.ctx.getWebSockets("tab").length > 0 });
    }
    return new Response("Not found", { status: 404 });
  }

  private async call(envelope: Envelope): Promise<Outcome> {
    const now = Date.now();
    if (now - this.minute.start > 60_000) this.minute = { start: now, calls: 0 };
    if (++this.minute.calls > LIMITS.callsPerMinute)
      return failure("rate_limited", "Too many Precipice calls this minute. Wait a moment and retry.");
    if (this.pending.size >= LIMITS.concurrent)
      return failure("rate_limited", "Too many Precipice calls in flight. Wait for earlier calls to finish.");
    const [socket] = this.ctx.getWebSockets("tab").slice(-1);
    if (!socket) return failure("precipice_unavailable", UNAVAILABLE);
    return new Promise<Outcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(envelope.id);
        resolve(
          failure(
            "precipice_unavailable",
            "Precipice didn't answer in time. It may be busy or asleep; ask the person to bring it to the front, then retry.",
          ),
        );
      }, LIMITS.callMs);
      this.pending.set(envelope.id, { resolve, timer });
      try {
        socket.send(JSON.stringify({ type: "call", ...envelope }));
      } catch {
        clearTimeout(timer);
        this.pending.delete(envelope.id);
        resolve(failure("precipice_unavailable", UNAVAILABLE));
      }
    });
  }

  async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message.length > LIMITS.exportBytes * 2) return;
    let parsed: { type?: string; id?: string; outcome?: Outcome };
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    if (parsed.type !== "result" || typeof parsed.id !== "string" || !parsed.outcome) return;
    const waiting = this.pending.get(parsed.id);
    if (!waiting) return;
    clearTimeout(waiting.timer);
    this.pending.delete(parsed.id);
    waiting.resolve(parsed.outcome);
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "closed");
    } catch {
      /* already closed */
    }
  }
}
