import {
  OAuthProvider,
  type AuthRequest,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMcpServer } from "../../src/mcp/server";
import { failure, type Envelope, type Grant, type Outcome } from "../../src/mcp/contracts";
import { McpRelay } from "./relay";
import { hostUser, issueHost, approveHost, exchangeHost, revokeHost } from "./hostAuth";

/**
 * The hosted Precipice MCP connector.
 *
 * - `/mcp` is the MCP endpoint (Streamable HTTP, stateless) behind OAuth 2.1.
 * - `/authorize` hands the person to the Precipice app, which shows the consent screen: the
 *   app already knows who they are (the publishing sign-in, same invite gate) and which scapes
 *   they have, which a server-rendered page never could.
 * - `/relay` is the hibernating WebSocket the open app keeps to its relay object.
 *
 * The Worker holds no scape content. Each tool call is forwarded to the person's open app and
 * executed there against the local library.
 */
export { McpRelay };

export interface Env {
  APP_ORIGIN: string;
  TICKET_SECRET: string;
  /** Set to "1" to switch the connector off without a deploy. */
  MCP_DISABLED?: string;
  PUBLISH_DB: D1Database;
  OAUTH_KV: KVNamespace;
  RELAY: DurableObjectNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
}

/** What the OAuth library encrypts into every access token for this connection. */
export interface Props {
  userId: string;
  connectionId: string;
  grant: Grant;
}

const REQUEST_MS = 10 * 60 * 1000;
const TICKET_MS = 60 * 1000;
const TOUCH_MS = 60 * 60 * 1000;
const encoder = new TextEncoder();

function randomId(prefix: string, bytes = 18): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return `${prefix}_${btoa(String.fromCharCode(...value)).replace(/[+/=]/g, (c) => (c === "+" ? "-" : c === "/" ? "_" : ""))}`;
}
async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function b64url(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
async function hmac(secret: string, value: string): Promise<string> {
  // Fail closed: a missing or short secret would make relay tickets forgeable.
  if (typeof secret !== "string" || secret.length < 32) throw new Error("TICKET_SECRET is not configured");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A short-lived, stateless proof that the socket opener is this user. Nothing is stored. */
export async function mintTicket(env: Env, userId: string, now = Date.now()): Promise<string> {
  const body = b64url(encoder.encode(JSON.stringify({ u: userId, e: now + TICKET_MS })));
  return `${body}.${await hmac(env.TICKET_SECRET, body)}`;
}
export async function readTicket(
  env: Env,
  ticket: string,
  now = Date.now(),
): Promise<string | null> {
  const [body, signature] = ticket.split(".");
  if (!body || !signature || !safeEqual(signature, await hmac(env.TICKET_SECRET, body)))
    return null;
  try {
    const { u, e } = JSON.parse(atob(body.replaceAll("-", "+").replaceAll("_", "/"))) as {
      u: string;
      e: number;
    };
    return typeof u === "string" && e > now ? u : null;
  } catch {
    return null;
  }
}

function cors(request: Request, env: Env): Headers {
  const headers = new Headers({ Vary: "Origin" });
  if ([env.APP_ORIGIN, "tauri://localhost"].includes(request.headers.get("Origin") ?? "")) {
    headers.set("Access-Control-Allow-Origin", request.headers.get("Origin")!);
    headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
  }
  return headers;
}
function json(request: Request, env: Env, body: unknown, status = 200): Response {
  const headers = cors(request, env);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}
function problem(request: Request, env: Env, error: string, message: string, status: number) {
  return json(request, env, { error, message }, status);
}

type User = { id: string; email: string; status: string };

/** The Precipice app's publishing session: the same accounts, invites and suspension. */
async function sessionUser(request: Request, env: Env): Promise<User | null> {
  const token = request.headers
    .get("Authorization")
    ?.match(/^Bearer ([A-Za-z0-9_-]{20,500})$/)?.[1];
  if (!token) return null;
  return env.PUBLISH_DB.prepare(
    "SELECT users.id, users.email, users.status FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?",
  )
    .bind(await sha256(token), Date.now())
    .first<User>();
}

type StoredRequest = {
  authRequest: AuthRequest;
  clientName: string;
  clientUri: string | null;
  redirectHost: string;
};

function clientLabel(name: string | undefined, redirectUri: string): string {
  const cleaned = (name ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 80);
  return cleaned || new URL(redirectUri).host || "An MCP client";
}

async function authorize(request: Request, env: Env): Promise<Response> {
  let authRequest: AuthRequest;
  try {
    authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (cause) {
    return new Response(cause instanceof Error ? cause.message : "Invalid authorization request", {
      status: 400,
    });
  }
  const client = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
  if (!client) return new Response("Unknown client", { status: 400 });
  await env.PUBLISH_DB.prepare("DELETE FROM mcp_auth_requests WHERE expires_at <= ?")
    .bind(Date.now())
    .run();
  const id = randomId("car");
  const stored: StoredRequest = {
    authRequest,
    clientName: clientLabel(client.clientName, authRequest.redirectUri),
    clientUri: client.clientUri ?? null,
    redirectHost: new URL(authRequest.redirectUri).host,
  };
  await env.PUBLISH_DB.prepare(
    "INSERT INTO mcp_auth_requests (id, payload, expires_at) VALUES (?, ?, ?)",
  )
    .bind(id, JSON.stringify(stored), Date.now() + REQUEST_MS)
    .run();
  const consent = new URL("/", env.APP_ORIGIN);
  consent.hash = `/connect/${id}`;
  return Response.redirect(consent.toString(), 302);
}

async function readRequest(env: Env, id: string): Promise<StoredRequest | null> {
  if (!/^car_[A-Za-z0-9_-]{10,40}$/.test(id)) return null;
  const row = await env.PUBLISH_DB.prepare(
    "SELECT payload FROM mcp_auth_requests WHERE id = ? AND expires_at > ?",
  )
    .bind(id, Date.now())
    .first<{ payload: string }>();
  return row ? (JSON.parse(row.payload) as StoredRequest) : null;
}

function parseApproval(body: unknown): Pick<Grant, "scapes" | "mode" | "write" | "host"> | null {
  if (!body || typeof body !== "object") return null;
  const { scapes, mode, write, host = "web" } = body as Record<string, unknown>;
  const validScapes =
    scapes === "all" ||
    (Array.isArray(scapes) &&
      scapes.length > 0 &&
      scapes.length <= 200 &&
      scapes.every((s) => typeof s === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(s)));
  if (
    (host !== "web" && host !== "desktop") ||
    !validScapes ||
    (mode !== "direct" && mode !== "review") ||
    typeof write !== "boolean"
  )
    return null;
  return { scapes: scapes as Grant["scapes"], mode, write, host };
}

async function app(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors(request, env) });
  if (url.pathname === "/" && request.method === "GET")
    return new Response("Precipice MCP connector. Add " + url.origin + "/mcp to your MCP client.", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  if (env.MCP_DISABLED === "1")
    return problem(
      request,
      env,
      "service_unavailable",
      "The Precipice connector is temporarily off.",
      503,
    );

  if (url.pathname === "/host/start" && request.method === "GET") {
    const challenge = url.searchParams.get("challenge") ?? "";
    if (!/^[a-f0-9]{64}$/.test(challenge))
      return new Response("Invalid challenge", { status: 400 });
    return Response.redirect(`${env.APP_ORIGIN}/#/host/${challenge}`, 302);
  }
  if (url.pathname === "/host/exchange" && request.method === "POST") {
    const session = await exchangeHost(env, await request.json().catch(() => ({})));
    return session
      ? json(request, env, session)
      : problem(request, env, "unauthorized", "Desktop sign-in expired. Try again.", 401);
  }
  if (url.pathname === "/authorize" && request.method === "GET") return authorize(request, env);

  if (url.pathname === "/relay" && request.headers.get("Upgrade") === "websocket") {
    const userId = await readTicket(env, url.searchParams.get("ticket") ?? "");
    if (!userId) return new Response("Unauthorized", { status: 401 });
    const stub = env.RELAY.get(env.RELAY.idFromName(userId));
    return stub.fetch(new Request("https://relay/socket", request));
  }

  // Everything below is called by the Precipice app with its publishing session.
  if (
    request.method !== "GET" &&
    ![env.APP_ORIGIN, "tauri://localhost"].includes(request.headers.get("Origin") ?? "")
  )
    return problem(request, env, "unauthorized", "Requests must come from Precipice.", 403);
  const hostIdentity =
    url.pathname === "/relay/ticket" ||
    url.pathname === "/host/session" ||
    url.pathname.startsWith("/connect/connections")
      ? await hostUser(request, env)
      : null;
  const user = hostIdentity ?? (await sessionUser(request, env));
  if (!user)
    return problem(request, env, "unauthorized", "Sign in to Precipice to connect agents.", 401);
  if (user.status !== "active")
    return problem(request, env, "account_suspended", "This account is suspended.", 403);

  if (url.pathname === "/host/session" && request.method === "DELETE") {
    if (!hostIdentity) return problem(request, env, "unauthorized", "Not a host credential.", 401);
    await revokeHost(env, request);
    return new Response(null, { status: 204, headers: cors(request, env) });
  }
  if (url.pathname === "/host/approve" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { challenge?: unknown };
    const redirectTo = await approveHost(env, user.id, body.challenge);
    return redirectTo
      ? json(request, env, { redirectTo })
      : problem(request, env, "invalid_request", "Invalid sign-in request.", 400);
  }

  if (url.pathname === "/relay/ticket" && request.method === "POST") {
    const host = hostIdentity?.host ?? "web";
    const row = await env.PUBLISH_DB.prepare(
      "SELECT COUNT(*) AS n FROM mcp_connections WHERE user_id = ? AND host = ?",
    )
      .bind(user.id, host)
      .first<{ n: number }>();
    const credential = !hostIdentity ? await issueHost(env, user.id, host) : undefined;
    return json(request, env, {
      ticket: await mintTicket(env, `${user.id}:${host}`),
      grants: Number(row?.n ?? 0),
      credential,
    });
  }

  const pending = url.pathname.match(/^\/connect\/requests\/([^/]+)(?:\/(approve|deny))?$/);
  if (pending) {
    const [, id, action] = pending;
    const stored = await readRequest(env, id);
    if (!stored)
      return problem(
        request,
        env,
        "not_found",
        "This connection request expired. Start again from your agent.",
        404,
      );
    if (request.method === "GET" && !action)
      return json(request, env, {
        clientName: stored.clientName,
        clientUri: stored.clientUri,
        redirectHost: stored.redirectHost,
        email: user.email,
      });
    if (request.method !== "POST") return problem(request, env, "not_found", "Not found.", 404);
    if (action !== "approve" && action !== "deny")
      return problem(request, env, "not_found", "Not found.", 404);
    const approval =
      action === "approve" ? parseApproval(await request.json().catch(() => null)) : null;
    if (action === "approve" && !approval)
      return problem(
        request,
        env,
        "invalid_request",
        "Choose which scapes and what access to allow.",
        400,
      );
    // DELETE RETURNING is the single-use claim; concurrent consent submissions cannot both win.
    const claimed = await env.PUBLISH_DB.prepare(
      "DELETE FROM mcp_auth_requests WHERE id = ? AND expires_at > ? RETURNING id",
    )
      .bind(id, Date.now())
      .first();
    if (!claimed)
      return problem(
        request,
        env,
        "not_found",
        "This request was already completed. Start again from your agent.",
        404,
      );
    if (action === "deny") {
      const redirect = new URL(stored.authRequest.redirectUri);
      redirect.searchParams.set("error", "access_denied");
      if (stored.authRequest.state) redirect.searchParams.set("state", stored.authRequest.state);
      return json(request, env, { redirectTo: redirect.toString() });
    }
    if (!approval) return problem(request, env, "invalid_request", "Invalid approval.", 400);
    const connectionId = randomId("mcx", 12);
    const grant: Grant = { clientId: connectionId, clientName: stored.clientName, ...approval };
    const now = Date.now();
    await env.PUBLISH_DB.prepare(
      "INSERT INTO mcp_connections (id, user_id, client_id, client_name, scapes, mode, can_write, created_at, last_used_at, host) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        connectionId,
        user.id,
        grant.clientId,
        grant.clientName,
        JSON.stringify(grant.scapes),
        grant.mode,
        grant.write ? 1 : 0,
        now,
        0,
        grant.host ?? "web",
      )
      .run();
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: stored.authRequest,
      userId: user.id,
      metadata: { connectionId, clientName: grant.clientName },
      scope: grant.write ? ["scape:read", "scape:write"] : ["scape:read"],
      props: { userId: user.id, connectionId, grant } satisfies Props,
    });
    return json(request, env, { redirectTo });
  }

  if (url.pathname === "/connect/connections" && request.method === "GET") {
    const rows = (
      await env.PUBLISH_DB.prepare(
        "SELECT id, client_name, scapes, mode, can_write, created_at, last_used_at FROM mcp_connections WHERE user_id = ? ORDER BY last_used_at DESC",
      )
        .bind(user.id)
        .all<{
          id: string;
          client_name: string;
          scapes: string;
          mode: string;
          can_write: number;
          created_at: number;
          last_used_at: number;
        }>()
    ).results;
    return json(request, env, {
      connections: rows.map((row) => ({
        id: row.id,
        clientName: row.client_name,
        scapes: JSON.parse(row.scapes),
        mode: row.mode,
        write: row.can_write === 1,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
      })),
    });
  }

  const policy = url.pathname.match(/^\/connect\/connections\/(mcx_[A-Za-z0-9_-]+)\/mode$/);
  if (policy && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { mode?: string };
    if (body.mode !== "direct" && body.mode !== "review")
      return problem(request, env, "invalid_request", "Choose a review mode.", 400);
    const updated = await env.PUBLISH_DB.prepare(
      "UPDATE mcp_connections SET mode = ? WHERE id = ? AND user_id = ? RETURNING id",
    )
      .bind(body.mode, policy[1], user.id)
      .first();
    return updated
      ? new Response(null, { status: 204, headers: cors(request, env) })
      : problem(request, env, "not_found", "Connection removed.", 404);
  }

  const connection = url.pathname.match(/^\/connect\/connections\/(mcx_[A-Za-z0-9_-]+)$/);
  if (connection && request.method === "DELETE") {
    await revokeConnection(env, user.id, connection[1]);
    return new Response(null, { status: 204, headers: cors(request, env) });
  }
  if (url.pathname === "/connect/connections" && request.method === "DELETE") {
    const rows = (
      await env.PUBLISH_DB.prepare("SELECT id FROM mcp_connections WHERE user_id = ?")
        .bind(user.id)
        .all<{ id: string }>()
    ).results;
    for (const row of rows) await revokeConnection(env, user.id, row.id);
    return new Response(null, { status: 204, headers: cors(request, env) });
  }

  return problem(request, env, "not_found", "Not found.", 404);
}

/** Removing the row revokes immediately (every call checks it); the OAuth grant follows. */
async function revokeConnection(env: Env, userId: string, connectionId: string): Promise<void> {
  await env.PUBLISH_DB.prepare("DELETE FROM mcp_connections WHERE id = ? AND user_id = ?")
    .bind(connectionId, userId)
    .run();
  let cursor: string | undefined;
  do {
    const page = await env.OAUTH_PROVIDER.listUserGrants(userId, { cursor });
    for (const grant of page.items)
      if ((grant.metadata as { connectionId?: string } | null)?.connectionId === connectionId)
        await env.OAUTH_PROVIDER.revokeGrant(grant.id, userId);
    cursor = page.cursor;
  } while (cursor);
}

/** Checks the connection still exists and its person is still allowed, on every request. */
async function liveConnection(env: Env, props: Props): Promise<Grant | null> {
  const row = await env.PUBLISH_DB.prepare(
    "SELECT mcp_connections.last_used_at, mcp_connections.mode, users.status FROM mcp_connections JOIN users ON users.id = mcp_connections.user_id WHERE mcp_connections.id = ? AND mcp_connections.user_id = ?",
  )
    .bind(props.connectionId, props.userId)
    .first<{ last_used_at: number; status: string; mode: "direct" | "review" }>();
  if (!row || row.status !== "active") return null;
  const now = Date.now();
  if (now - row.last_used_at > TOUCH_MS)
    await env.PUBLISH_DB.prepare("UPDATE mcp_connections SET last_used_at = ? WHERE id = ?")
      .bind(now, props.connectionId)
      .run();
  return { ...props.grant, mode: row.mode };
}

export async function callRelay(env: Env, userId: string, envelope: Envelope): Promise<Outcome> {
  const stub = env.RELAY.get(env.RELAY.idFromName(userId));
  const response = await stub.fetch("https://relay/call", {
    method: "POST",
    body: JSON.stringify(envelope),
  });
  if (!response.ok)
    return failure("precipice_unavailable", "The Precipice relay is unavailable. Retry shortly.");
  return (await response.json()) as Outcome;
}

/** Atomic across isolates; the singleton row resets on the next UTC day. */
export async function takeBudget(env: Env, now = Date.now()): Promise<boolean> {
  const day = new Date(now).toISOString().slice(0, 10);
  const row = await env.PUBLISH_DB.prepare(
    `INSERT INTO mcp_budget (id, day, requests) VALUES (1, ?, 1)
     ON CONFLICT(id) DO UPDATE SET day = excluded.day,
       requests = CASE WHEN mcp_budget.day = excluded.day THEN mcp_budget.requests + 1 ELSE 1 END
     WHERE mcp_budget.day != excluded.day OR mcp_budget.requests < 25000
     RETURNING requests`,
  )
    .bind(day)
    .first();
  return row !== null;
}

const mcpApi = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext & { props?: Props },
  ): Promise<Response> {
    if (env.MCP_DISABLED === "1")
      return Response.json(
        { error: "service_unavailable", message: "The Precipice connector is temporarily off." },
        { status: 503 },
      );
    const props = ctx.props;
    const grant = props ? await liveConnection(env, props) : null;
    if (!props || !grant)
      return new Response(
        JSON.stringify({
          error: "invalid_token",
          error_description: "This connection was removed. Reconnect Precipice in your agent.",
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "WWW-Authenticate": 'Bearer error="invalid_token"',
          },
        },
      );
    if (!(await takeBudget(env)))
      return Response.json(
        {
          error: "daily_limit",
          message: "Precipice's daily connector budget is used up. Retry after midnight UTC.",
        },
        { status: 429 },
      );
    const server = buildMcpServer((tool, args) =>
      callRelay(env, `${props.userId}:${grant.host ?? "web"}`, {
        id: crypto.randomUUID(),
        tool,
        args,
        grant,
      }),
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};

/** The resource identifier is this Worker's own `/mcp` URL, so the provider is built per origin. */
const providers = new Map<string, OAuthProvider<Env>>();
function provider(origin: string): OAuthProvider<Env> {
  let existing = providers.get(origin);
  if (!existing) {
    existing = new OAuthProvider<Env>({
      apiRoute: "/mcp",
      apiHandler: mcpApi as never,
      defaultHandler: { fetch: app as never },
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/token",
      clientRegistrationEndpoint: "/register",
      scopesSupported: ["scape:read", "scape:write"],
      // Claude and Codex identify themselves with a Client ID Metadata Document; older clients
      // fall back to dynamic registration.
      clientIdMetadataDocumentEnabled: true,
      resourceMetadata: {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        scopes_supported: ["scape:read", "scape:write"],
        bearer_methods_supported: ["header"],
        resource_name: "Precipice",
      },
      // Long access tokens keep KV writes (refreshes) low on the free plan; the connection row
      // is checked on every call, so revocation stays immediate regardless.
      accessTokenTTL: 12 * 60 * 60,
      refreshTokenTTL: 90 * 24 * 60 * 60,
      // A connection lives as long as it is used: each refresh extends it.
      refreshTokenIdleTTL: 90 * 24 * 60 * 60,
    });
    providers.set(origin, existing);
  }
  return existing;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return provider(new URL(request.url).origin).fetch(request, env, ctx);
  },
};

export { app as __app, mcpApi as __mcpApi };
