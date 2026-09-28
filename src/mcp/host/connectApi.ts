import { readSession } from "@/publish/session";
import { hostToken } from "./credential";
import { MCP_ORIGIN } from "./relay";

/** The app's calls to the MCP Worker, authenticated with the publishing session. */

export interface ConnectRequest {
  clientName: string;
  clientUri: string | null;
  redirectHost: string;
  email: string;
}

export interface AgentConnection {
  id: string;
  clientName: string;
  scapes: "all" | string[];
  mode: "direct" | "review";
  write: boolean;
  createdAt: number;
  lastUsedAt: number;
}

export class ConnectError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = path.startsWith("/connect/connections") ? hostToken() : readSession()?.token;
  if (!token) throw new ConnectError("unauthorized", "Sign in to continue.");
  const response = await fetch(`${MCP_ORIGIN}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).catch(() => {
    throw new ConnectError(
      "network",
      "Could not reach Precipice's connector. Check your connection.",
    );
  });
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
  };
  if (!response.ok)
    throw new ConnectError(
      payload.error ?? "server_error",
      payload.message ?? "Something went wrong.",
    );
  return payload;
}

export const connectApi = {
  request: (id: string) =>
    call<ConnectRequest>("GET", `/connect/requests/${encodeURIComponent(id)}`),
  approve: (
    id: string,
    approval: {
      scapes: "all" | string[];
      mode: "direct" | "review";
      write: boolean;
      host?: "web" | "desktop";
    },
  ) =>
    call<{ redirectTo: string }>(
      "POST",
      `/connect/requests/${encodeURIComponent(id)}/approve`,
      approval,
    ),
  deny: (id: string) =>
    call<{ redirectTo: string }>("POST", `/connect/requests/${encodeURIComponent(id)}/deny`),
  connections: () =>
    call<{ connections: AgentConnection[] }>("GET", "/connect/connections").then(
      (r) => r.connections,
    ),
  mode: (id: string, mode: "review" | "direct") =>
    call<void>("POST", `/connect/connections/${encodeURIComponent(id)}/mode`, { mode }),
  revoke: (id: string) => call<void>("DELETE", `/connect/connections/${encodeURIComponent(id)}`),
  revokeAll: () => call<void>("DELETE", "/connect/connections"),
};
