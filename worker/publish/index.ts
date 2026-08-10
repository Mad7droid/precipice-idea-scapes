import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  ERROR_STATUS,
  LIMITS,
  PUBLICATION_ID_PATTERN,
  PUBLICATION_LIMIT,
  canonicalHash,
  publicationListSchema,
  publicationPointerSchema,
  publicationSchema,
  publishRequestSchema,
  type PublishErrorCode,
  type PublishedScape,
} from "../../src/publish/contract";

type RateLimit = { limit(options: { key: string }): Promise<{ success: boolean }> };
type Env = {
  APP_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  PUBLISH_DB: D1Database;
  PUBLICATIONS: R2Bucket;
  PUBLISH_LIMIT: RateLimit;
};
type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };
type User = { id: string; email: string; display_name: string | null };
type PublicationRow = {
  publication_id: string;
  status: "published" | "unpublished" | "deleted";
  version: number;
  hash: string;
  updated_at: number;
};

const encoder = new TextEncoder();
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const STATE_MS = 10 * 60 * 1000;
const EXCHANGE_MS = 60 * 1000;
const ALLOWED_TYPES = new Set(["note", "journey", "wireframe"]);

function randomBase64Url(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function publicationId(): string {
  // 128 bits, base32 alphabet required by the frozen contract.
  const bytes = new Uint8Array(17);
  crypto.getRandomValues(bytes);
  let bits = 0;
  let count = 0;
  let result = "";
  for (const byte of bytes) {
    bits = (bits << 8) | byte;
    count += 8;
    while (count >= 5 && result.length < 26) {
      result += "0123456789abcdefghijklmnopqrstuv"[(bits >>> (count - 5)) & 31];
      count -= 5;
    }
  }
  return `pub_${result}`;
}

async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function pkceChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(hash))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function safeReturn(value: string | null): string {
  if (!value || value.length > 200 || !value.startsWith("/") || value.startsWith("//") || /[:\\\x00-\x1f\x7f]/.test(value)) return "/";
  return value;
}

function cors(request: Request, env: Env, isPublic = false): Headers {
  const headers = new Headers({ Vary: "Origin" });
  if (isPublic) headers.set("Access-Control-Allow-Origin", "*");
  else if (request.headers.get("Origin") === env.APP_ORIGIN) headers.set("Access-Control-Allow-Origin", env.APP_ORIGIN);
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Max-Age", "86400");
  return headers;
}

function response(request: Request, env: Env, body: unknown, status = 200, isPublic = false): Response {
  const headers = cors(request, env, isPublic);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers });
}

function error(request: Request, env: Env, code: PublishErrorCode, message?: string, isPublic = false): Response {
  return response(request, env, { error: code, ...(message ? { message } : {}) }, ERROR_STATUS[code], isPublic);
}

async function limited(request: Request, env: Env): Promise<boolean> {
  const key = request.headers.get("CF-Connecting-IP") ?? "unknown";
  return (await env.PUBLISH_LIMIT.limit({ key })).success;
}

async function parseJson(request: Request): Promise<unknown | Response> {
  const body = await request.arrayBuffer();
  if (body.byteLength > LIMITS.payloadBytes) return new Response(null, { status: 413 });
  try { return JSON.parse(new TextDecoder().decode(body)); } catch { return null; }
}

async function sessionUser(request: Request, env: Env): Promise<User | null> {
  const token = request.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]{20,500})$/)?.[1];
  if (!token) return null;
  const now = Date.now();
  const row = await env.PUBLISH_DB.prepare(
    "SELECT users.id, users.email, users.display_name FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?",
  ).bind(await sha256(token), now).first<User>();
  return row ?? null;
}

function snapshotKey(id: string, version: number): string { return `publications/${id}/v${version}/scape.json`; }
function publicUrl(env: Env, id: string): string { return `${env.APP_ORIGIN}/p/${id}`; }
function asPublication(env: Env, row: PublicationRow) {
  return publicationSchema.parse({ publicationId: row.publication_id, hash: row.hash, version: row.version, status: row.status, url: publicUrl(env, row.publication_id), updatedAt: row.updated_at });
}

async function readOwnerPublication(env: Env, id: string, userId: string): Promise<PublicationRow | null> {
  return env.PUBLISH_DB.prepare("SELECT publication_id, status, version, hash, updated_at FROM publications WHERE publication_id = ? AND owner_id = ?").bind(id, userId).first<PublicationRow>();
}

async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix, cursor });
    if (listed.objects.length) await bucket.delete(listed.objects.map((object) => object.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

async function authStart(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const state = randomBase64Url();
  const verifier = randomBase64Url();
  const now = Date.now();
  await env.PUBLISH_DB.prepare("INSERT INTO oauth_states (state, code_verifier, return_path, expires_at) VALUES (?, ?, ?, ?)")
    .bind(state, verifier, safeReturn(url.searchParams.get("return")), now + STATE_MS).run();
  const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  google.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${new URL(request.url).origin}/auth/callback`, response_type: "code", scope: "openid email profile", state, code_challenge: await pkceChallenge(verifier), code_challenge_method: "S256", prompt: "select_account" }).toString();
  return Response.redirect(google.toString(), 302);
}

async function authCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) return error(request, env, "unauthorized", "Google sign-in was cancelled.");
  const pending = await env.PUBLISH_DB.prepare("DELETE FROM oauth_states WHERE state = ? AND expires_at > ? RETURNING code_verifier, return_path").bind(state, Date.now()).first<{ code_verifier: string; return_path: string }>();
  if (!pending) return error(request, env, "unauthorized", "Sign-in session expired. Please try again.");
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${url.origin}/auth/callback`, grant_type: "authorization_code", code_verifier: pending.code_verifier }) });
  if (!tokenResponse.ok) return error(request, env, "unauthorized", "Google could not complete sign-in.");
  const token = await tokenResponse.json() as { id_token?: string };
  if (!token.id_token) return error(request, env, "unauthorized", "Google did not return an identity token.");
  let claims: { sub: string; email: string; name?: string; email_verified?: boolean };
  try {
    const verified = await jwtVerify(token.id_token, googleKeys, { audience: env.GOOGLE_CLIENT_ID, issuer: ["https://accounts.google.com", "accounts.google.com"] });
    claims = verified.payload as typeof claims;
  } catch { return error(request, env, "unauthorized", "Google identity verification failed."); }
  if (!claims.sub || !claims.email || claims.email_verified !== true) return error(request, env, "unauthorized", "A verified Google email is required.");
  const now = Date.now();
  const userId = `usr_${await sha256(claims.sub)}`;
  const sessionId = `ses_${randomBase64Url(18)}`;
  const sessionSeed = randomBase64Url();
  const exchange = randomBase64Url();
  await env.PUBLISH_DB.batch([
    env.PUBLISH_DB.prepare("INSERT INTO users (id, google_sub, email, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, updated_at = excluded.updated_at").bind(userId, claims.sub, claims.email, claims.name?.slice(0, 200) ?? null, now, now),
    env.PUBLISH_DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    // This temporary value is never sent to the browser. The actual bearer token is minted
    // only after the one-time exchange, and D1 stores hashes only at every stage.
    env.PUBLISH_DB.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").bind(sessionId, userId, await sha256(sessionSeed), now + SESSION_MS, now),
    env.PUBLISH_DB.prepare("INSERT INTO exchange_codes (code, session_id, expires_at) VALUES (?, ?, ?)").bind(exchange, sessionId, now + EXCHANGE_MS),
  ]);
  const redirect = new URL(pending.return_path, env.APP_ORIGIN);
  redirect.hash = new URLSearchParams({ token: exchange }).toString();
  return Response.redirect(redirect.toString(), 302);
}

async function authExchange(request: Request, env: Env): Promise<Response> {
  const payload = await parseJson(request);
  if (payload instanceof Response) return error(request, env, "too_large");
  const code = typeof (payload as { token?: unknown } | null)?.token === "string" ? (payload as { token: string }).token : "";
  if (!/^[A-Za-z0-9_-]{20,500}$/.test(code)) return error(request, env, "unauthorized");
  const exchange = await env.PUBLISH_DB.prepare("DELETE FROM exchange_codes WHERE code = ? AND expires_at > ? RETURNING session_id").bind(code, Date.now()).first<{ session_id: string }>();
  if (!exchange) return error(request, env, "unauthorized", "Sign-in code expired. Please try again.");
  const row = await env.PUBLISH_DB.prepare("SELECT sessions.expires_at, users.email, users.display_name FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id = ?").bind(exchange.session_id).first<{ expires_at: number; email: string; display_name: string | null }>();
  if (!row) return error(request, env, "unauthorized");
  const token = randomBase64Url();
  await env.PUBLISH_DB.prepare("UPDATE sessions SET token_hash = ? WHERE id = ?").bind(await sha256(token), exchange.session_id).run();
  return response(request, env, { token, expiresAt: row.expires_at, email: row.email, ...(row.display_name ? { name: row.display_name } : {}) });
}

async function publish(request: Request, env: Env, user: User, id?: string): Promise<Response> {
  const payload = await parseJson(request);
  if (payload instanceof Response) return error(request, env, "too_large");
  const parsed = publishRequestSchema.safeParse(payload);
  if (!parsed.success || parsed.data.scape.objects.some((object) => !ALLOWED_TYPES.has(object.type))) return error(request, env, "invalid_projection");
  const scape: PublishedScape = { ...parsed.data.scape, relationships: parsed.data.scape.relationships.filter((edge) => parsed.data.scape.objects.some((object) => object.id === edge.from) && parsed.data.scape.objects.some((object) => object.id === edge.to)) };
  const hash = await canonicalHash(scape);
  const now = Date.now();
  if (id) {
    if (!PUBLICATION_ID_PATTERN.test(id)) return error(request, env, "not_found");
    const existing = await readOwnerPublication(env, id, user.id);
    if (!existing) return error(request, env, "not_found");
    if (existing.status !== "published") return error(request, env, "unpublished");
    const version = existing.version + 1;
    await env.PUBLICATIONS.put(snapshotKey(id, version), JSON.stringify(scape), { httpMetadata: { contentType: "application/json" } });
    await env.PUBLISH_DB.batch([
      env.PUBLISH_DB.prepare("UPDATE publications SET version = ?, hash = ?, updated_at = ? WHERE publication_id = ? AND owner_id = ? AND status = 'published'").bind(version, hash, now, id, user.id),
      env.PUBLISH_DB.prepare("INSERT OR REPLACE INTO superseded_versions (publication_id, version, delete_after) VALUES (?, ?, ?)").bind(id, existing.version, now + 7 * 24 * 60 * 60 * 1000),
    ]);
    return response(request, env, asPublication(env, { publication_id: id, status: "published", version, hash, updated_at: now }));
  }
  const newId = publicationId();
  const insert = await env.PUBLISH_DB.prepare("INSERT INTO publications (publication_id, owner_id, status, version, hash, updated_at, created_at) SELECT ?, ?, 'published', 1, ?, ?, ? WHERE (SELECT COUNT(*) FROM publications WHERE owner_id = ? AND status = 'published') < ?").bind(newId, user.id, hash, now, now, user.id, PUBLICATION_LIMIT).run();
  if (!insert.meta.changes) return error(request, env, "quota_exceeded");
  try { await env.PUBLICATIONS.put(snapshotKey(newId, 1), JSON.stringify(scape), { httpMetadata: { contentType: "application/json" } }); }
  catch { await env.PUBLISH_DB.prepare("DELETE FROM publications WHERE publication_id = ? AND owner_id = ?").bind(newId, user.id).run(); return error(request, env, "server_error"); }
  return response(request, env, asPublication(env, { publication_id: newId, status: "published", version: 1, hash, updated_at: now }), 201);
}

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const publicMatch = url.pathname.match(/^\/p\/(pub_[0-9a-z]{26})(?:\/v(\d+)\/scape\.json)?$/);
  const mutation = request.method !== "GET" && request.method !== "OPTIONS";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request, env, !!publicMatch) });
  // `/auth/start` and `/auth/callback` are top-level navigations, so browsers do not attach an
  // Origin header. The POST exchange and every mutation remain exact-origin CORS requests.
  if (mutation && request.headers.get("Origin") !== env.APP_ORIGIN) return error(request, env, "unauthorized");
  if ((mutation || url.pathname.startsWith("/auth/") || publicMatch) && !(await limited(request, env))) return error(request, env, "rate_limited", undefined, !!publicMatch);
  if (request.method === "GET" && publicMatch) {
    const [, id, version] = publicMatch;
    const row = await env.PUBLISH_DB.prepare("SELECT publication_id, status, version, hash, updated_at FROM publications WHERE publication_id = ?").bind(id).first<PublicationRow>();
    if (!row || row.status === "deleted") return error(request, env, "not_found", undefined, true);
    if (row.status === "unpublished") return error(request, env, "unpublished", undefined, true);
    if (version) {
      if (Number(version) !== row.version) return error(request, env, "not_found", undefined, true);
      const object = await env.PUBLICATIONS.get(snapshotKey(id, row.version));
      if (!object) return error(request, env, "not_found", undefined, true);
      const headers = cors(request, env, true); headers.set("Content-Type", "application/json; charset=utf-8"); headers.set("Cache-Control", "public, max-age=31536000, immutable"); headers.set("X-Content-Type-Options", "nosniff");
      return new Response(object.body, { headers });
    }
    return response(request, env, publicationPointerSchema.parse({ publicationId: id, version: row.version, hash: row.hash, snapshotPath: `/p/${id}/v${row.version}/scape.json`, updatedAt: row.updated_at }), 200, true);
  }
  if (request.method === "GET" && url.pathname === "/auth/start") return authStart(request, env);
  if (request.method === "GET" && url.pathname === "/auth/callback") return authCallback(request, env);
  if (request.method === "POST" && url.pathname === "/auth/exchange") return authExchange(request, env);
  const user = await sessionUser(request, env);
  if (!user) return error(request, env, "unauthorized");
  if (request.method === "POST" && url.pathname === "/auth/logout") { await env.PUBLISH_DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run(); return new Response(null, { status: 204, headers: cors(request, env) }); }
  if (request.method === "DELETE" && url.pathname === "/account") {
    const ids = (await env.PUBLISH_DB.prepare("SELECT publication_id FROM publications WHERE owner_id = ?").bind(user.id).all<{ publication_id: string }>()).results;
    await Promise.all(ids.map((row) => deletePrefix(env.PUBLICATIONS, `publications/${row.publication_id}/`)));
    // Be explicit rather than relying on a connection-level foreign-key pragma: account deletion
    // is the retention boundary for the personal data held by this Worker.
    await env.PUBLISH_DB.batch([
      env.PUBLISH_DB.prepare("DELETE FROM exchange_codes WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ?)").bind(user.id),
      env.PUBLISH_DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
      env.PUBLISH_DB.prepare("DELETE FROM superseded_versions WHERE publication_id IN (SELECT publication_id FROM publications WHERE owner_id = ?)").bind(user.id),
      env.PUBLISH_DB.prepare("DELETE FROM publications WHERE owner_id = ?").bind(user.id),
      env.PUBLISH_DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
    ]);
    return new Response(null, { status: 204, headers: cors(request, env) });
  }
  if (request.method === "GET" && url.pathname === "/publications") { const rows = (await env.PUBLISH_DB.prepare("SELECT publication_id, status, version, hash, updated_at FROM publications WHERE owner_id = ? AND status != 'deleted' ORDER BY updated_at DESC").bind(user.id).all<PublicationRow>()).results; const publications = rows.map((row) => asPublication(env, row)); return response(request, env, publicationListSchema.parse({ publications, limit: PUBLICATION_LIMIT, used: rows.filter((row) => row.status === "published").length })); }
  if (request.method === "POST" && url.pathname === "/publications") return publish(request, env, user);
  const match = url.pathname.match(/^\/publications\/(pub_[0-9a-z]{26})(?:\/(unpublish|republish))?$/);
  if (!match) return error(request, env, "not_found");
  const [, id, action] = match;
  if (request.method === "PUT" && !action) return publish(request, env, user, id);
  const existing = await readOwnerPublication(env, id, user.id);
  if (!existing) return error(request, env, "not_found");
  if (request.method === "POST" && action === "unpublish") { if (existing.status !== "published") return error(request, env, "unpublished"); const now = Date.now(); await env.PUBLISH_DB.prepare("UPDATE publications SET status = 'unpublished', updated_at = ? WHERE publication_id = ? AND owner_id = ? AND status = 'published'").bind(now, id, user.id).run(); return response(request, env, asPublication(env, { ...existing, status: "unpublished", updated_at: now })); }
  if (request.method === "POST" && action === "republish") { if (existing.status !== "unpublished") return error(request, env, "invalid_projection"); const now = Date.now(); const result = await env.PUBLISH_DB.prepare("UPDATE publications SET status = 'published', updated_at = ? WHERE publication_id = ? AND owner_id = ? AND status = 'unpublished' AND (SELECT COUNT(*) FROM publications WHERE owner_id = ? AND status = 'published') < ?").bind(now, id, user.id, user.id, PUBLICATION_LIMIT).run(); if (!result.meta.changes) return error(request, env, "quota_exceeded"); return response(request, env, asPublication(env, { ...existing, status: "published", updated_at: now })); }
  if (request.method === "DELETE" && !action) { await deletePrefix(env.PUBLICATIONS, `publications/${id}/`); await env.PUBLISH_DB.prepare("UPDATE publications SET status = 'deleted', updated_at = ? WHERE publication_id = ? AND owner_id = ?").bind(Date.now(), id, user.id).run(); return new Response(null, { status: 204, headers: cors(request, env) }); }
  return error(request, env, "not_found");
}

export default { fetch: (request: Request, env: Env, ctx: ExecutionContext) => handle(request, env, ctx), async scheduled(_event: ScheduledEvent, env: Env): Promise<void> { const due = (await env.PUBLISH_DB.prepare("SELECT publication_id, version FROM superseded_versions WHERE delete_after <= ?").bind(Date.now()).all<{ publication_id: string; version: number }>()).results; await Promise.all(due.map(async (row) => { await env.PUBLICATIONS.delete(snapshotKey(row.publication_id, row.version)); await env.PUBLISH_DB.prepare("DELETE FROM superseded_versions WHERE publication_id = ? AND version = ?").bind(row.publication_id, row.version).run(); })); } };

export { safeReturn };
