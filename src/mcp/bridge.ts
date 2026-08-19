import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionPayload } from "@/core/actions";
import type { Scape } from "@/core/types";

const BRIDGE_ORIGIN = "http://127.0.0.1:38383";
const POLL_MS = 750;

export interface BridgeCommand {
  id: string;
  actions: ActionPayload[];
}

export interface BridgeApplyResult {
  applied: number;
  skipped: number;
}

export interface McpBridge {
  status: "idle" | "connecting" | "connected" | "unavailable";
  pairingCode: string | null;
  directApply: boolean;
  pending: BridgeCommand[];
  setDirectApply: (enabled: boolean) => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  applyPending: (id: string) => void;
  rejectPending: (id: string) => void;
}

function pairingCode(): string {
  // Ambiguous characters are excluded because this is typed into a chat host by a person.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

async function request(path: string, init: RequestInit, code?: string): Promise<Response> {
  return fetch(`${BRIDGE_ORIGIN}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(code ? { "X-Precipice-Bridge-Code": code } : {}),
    },
  });
}

/**
 * Pairs the open browser tab with the local stdio MCP server.
 *
 * The server owns no durable data. It has the current snapshot only while the tab is paired;
 * actions return through `apply`, which is kept in Editor so the normal reducer, validation,
 * autosave and undo behaviour remain in charge.
 */
export function useMcpBridge({
  scape,
  apply,
  currentScape,
}: {
  scape: Scape | null;
  apply: (actions: ActionPayload[]) => BridgeApplyResult;
  currentScape: () => Scape | null;
}): McpBridge {
  const [status, setStatus] = useState<McpBridge["status"]>("idle");
  const [pairCode, setPairingCode] = useState<string | null>(null);
  const [directApply, setDirectApply] = useState(false);
  const [pending, setPending] = useState<BridgeCommand[]>([]);
  const sessionId = useRef<string | null>(null);
  const code = useRef<string | null>(null);
  const scapeRef = useRef(scape);
  const applyRef = useRef(apply);
  const currentScapeRef = useRef(currentScape);

  useEffect(() => {
    scapeRef.current = scape;
    applyRef.current = apply;
    currentScapeRef.current = currentScape;
  }, [scape, apply, currentScape]);

  const disconnect = useCallback(async () => {
    const id = sessionId.current;
    const secret = code.current;
    sessionId.current = null;
    code.current = null;
    setPairingCode(null);
    setPending([]);
    setStatus("idle");
    if (id && secret) {
      try {
        await request(`/bridge/sessions/${id}/disconnect`, { method: "DELETE" }, secret);
      } catch {
        // The local process may already be gone. The session is in-memory and disappears with it.
      }
    }
  }, []);

  const connect = useCallback(async () => {
    const snapshot = scapeRef.current;
    if (!snapshot) return;
    if (sessionId.current) await disconnect();
    const nextCode = pairingCode();
    setStatus("connecting");
    try {
      const response = await request(
        "/bridge/sessions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scape: snapshot }),
        },
        nextCode,
      );
      if (!response.ok) throw new Error("bridge unavailable");
      const body = (await response.json()) as { sessionId?: string };
      if (!body.sessionId) throw new Error("bridge unavailable");
      sessionId.current = body.sessionId;
      code.current = nextCode;
      setPairingCode(nextCode);
      setStatus("connected");
    } catch {
      setStatus("unavailable");
    }
  }, [disconnect]);

  const acknowledge = useCallback(async (
    commandId: string,
    status: "applied" | "awaiting_review" | "rejected",
    result?: BridgeApplyResult,
  ) => {
    const id = sessionId.current;
    const secret = code.current;
    if (!id || !secret) return;
    const snapshot = currentScapeRef.current();
    try {
      await request(
        `/bridge/sessions/${id}/commands/${commandId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status,
            ...(result ?? {}),
            ...(snapshot ? { scape: snapshot } : {}),
          }),
        },
        secret,
      );
    } catch {
      setStatus("unavailable");
    }
  }, []);

  const applyPending = useCallback(
    (id: string) => {
      const command = pending.find((item) => item.id === id);
      if (!command) return;
      const result = applyRef.current(command.actions);
      setPending((items) => items.filter((item) => item.id !== id));
      void acknowledge(id, "applied", result);
    },
    [acknowledge, pending],
  );

  const rejectPending = useCallback(
    (id: string) => {
      setPending((items) => items.filter((item) => item.id !== id));
      void acknowledge(id, "rejected");
    },
    [acknowledge],
  );

  // Keep the bridge's working copy fresh. A paired MCP process is an ephemeral view, not a
  // second persistence layer, so the browser remains the private source of truth.
  useEffect(() => {
    const id = sessionId.current;
    const secret = code.current;
    if (!id || !secret || !scape) return;
    const timeout = window.setTimeout(() => {
      void request(
        `/bridge/sessions/${id}/scape`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scape }) },
        secret,
      ).catch(() => setStatus("unavailable"));
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [scape]);

  useEffect(() => {
    if (status !== "connected") return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      const id = sessionId.current;
      const secret = code.current;
      if (!id || !secret || cancelled) return;
      try {
        const response = await request(`/bridge/sessions/${id}/commands`, { method: "GET" }, secret);
        if (!response.ok) throw new Error("bridge unavailable");
        const body = (await response.json()) as { commands?: BridgeCommand[] };
        for (const command of body.commands ?? []) {
          if (cancelled) return;
          if (directApply) {
            const result = applyRef.current(command.actions);
            await acknowledge(command.id, "applied", result);
          } else {
            setPending((items) => (items.some((item) => item.id === command.id) ? items : [...items, command]));
            await acknowledge(command.id, "awaiting_review");
          }
        }
      } catch {
        if (!cancelled) setStatus("unavailable");
      }
      if (!cancelled) timer = window.setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [acknowledge, directApply, status]);

  return {
    status,
    pairingCode: pairCode,
    directApply,
    pending,
    setDirectApply,
    connect,
    disconnect,
    applyPending,
    rejectPending,
  };
}
