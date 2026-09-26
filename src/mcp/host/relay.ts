import { readSession } from "@/publish/session";
import type { Outcome } from "@/mcp/contracts";
import type { Envelope } from "@/mcp/contracts";
import { agentHost } from "./host";
import { useAgentStore } from "./agentStore";

/**
 * The browser end of the hosted MCP relay.
 *
 * One tab per browser holds a single WebSocket to the person's relay object (a Web Lock picks
 * the tab; when it closes, another takes over). The socket carries nothing until an agent
 * calls a tool, and it never polls: the relay hibernates while idle and costs nothing. When
 * the socket drops it reconnects on its own, so a person never has to press "Connect".
 */
export const MCP_ORIGIN = (import.meta.env.VITE_MCP_URL ?? "").replace(/\/+$/, "");
export const MCP_ENDPOINT = MCP_ORIGIN ? `${MCP_ORIGIN}/mcp` : "";

type RelayMessage =
  | ({ type: "call" } & Envelope)
  | { type: "result"; id: string; outcome: Outcome }
  | { type: "hello"; host: "web" | "desktop" };

const BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 60_000];

export interface RelayController {
  /** Re-check sign-in and grants now, e.g. right after the person approves a connection. */
  refresh(): void;
  stop(): void;
}

export function startRelay(host: "web" | "desktop"): RelayController {
  const store = useAgentStore.getState;
  if (!MCP_ORIGIN) {
    store().setRemote("off");
    return { refresh() {}, stop() {} };
  }

  let socket: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let releaseLock: (() => void) | null = null;
  let lockRequested = false;
  let holding = false;
  const retired = new WeakSet<WebSocket>();

  const schedule = () => {
    if (stopped) return;
    clearTimeout(retry);
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    retry = setTimeout(() => void connect(), delay);
  };

  async function connect() {
    if (stopped || socket) return;
    const session = readSession();
    if (!session) {
      store().setRemote("signed_out");
      return;
    }
    store().setRemote("connecting");
    let ticket: { ticket?: string; grants?: number };
    try {
      const response = await fetch(`${MCP_ORIGIN}/relay/ticket`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (response.status === 401 || response.status === 403) {
        store().setRemote("signed_out");
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      ticket = await response.json();
    } catch {
      store().setRemote("unavailable");
      schedule();
      return;
    }
    // No connected agents means nothing could ever call; stay offline and free.
    if (!ticket.ticket || !ticket.grants) {
      store().setRemote("off");
      return;
    }
    const url = new URL(`${MCP_ORIGIN}/relay`);
    url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
    url.searchParams.set("ticket", ticket.ticket);
    const ws = new WebSocket(url);
    socket = ws;
    ws.addEventListener("open", () => {
      attempt = 0;
      store().setRemote("connected");
      ws.send(JSON.stringify({ type: "hello", host } satisfies RelayMessage));
    });
    ws.addEventListener("message", (event) => {
      let message: RelayMessage;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.type !== "call") return;
      const { id, tool, args, grant } = message;
      void agentHost()
        .execute({ id, tool, args, grant })
        .then((outcome) => {
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: "result", id, outcome } satisfies RelayMessage));
        });
    });
    ws.addEventListener("close", (event) => {
      if (socket === ws) socket = null;
      if (stopped || retired.has(ws)) return;
      // 4401: the ticket or session is no longer valid. Wait for a fresh sign-in.
      if (event.code === 4401) {
        store().setRemote("signed_out");
        return;
      }
      // 4000: another Precipice (a desktop app, another browser) took over the connection.
      // Stay quiet until this one is brought to the front, which reclaims it.
      if (event.code === 4000) {
        store().setRemote("off");
        return;
      }
      store().setRemote("connecting");
      schedule();
    });
  }

  /** Only the tab holding the lock connects; the rest wait in line for it. */
  function acquire() {
    if (lockRequested || stopped) return;
    lockRequested = true;
    if (!("locks" in navigator)) {
      holding = true;
      void connect();
      return;
    }
    void navigator.locks.request("precipice-mcp-relay", () => {
      holding = true;
      void connect();
      return new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
    });
  }

  const wake = () => {
    if (document.visibilityState === "hidden") return;
    if (!socket && holding) {
      attempt = 0;
      void connect();
    }
  };
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("storage", (event) => {
    if (event.key === "precipice.publishSession") wake();
  });

  acquire();

  return {
    refresh() {
      attempt = 0;
      if (socket) {
        retired.add(socket);
        socket.close(1000, "refresh");
        socket = null;
      }
      if (holding) void connect();
      else acquire();
    },
    stop() {
      stopped = true;
      clearTimeout(retry);
      socket?.close(1000, "stopped");
      socket = null;
      releaseLock?.();
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    },
  };
}
