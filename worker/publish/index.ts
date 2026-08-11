import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  ACCOUNT_STORAGE_LIMIT,
  DAILY_WRITE_LIMIT,
  ERROR_STATUS,
  LIMITS,
  PUBLICATION_ID_PATTERN,
  PUBLICATION_LIMIT,
  adminListSchema,
  authStartRequestSchema,
  authStartSchema,
  canonicalHash,
  publicationListSchema,
  publicationPointerSchema,
  publicationSchema,
  publishRequestSchema,
  type PublishErrorCode,
  type PublishedScape,
} from "../../src/publish/contract";

type RateLimit = { limit(options: { key: string }): Promise<{ success: boolean }> };
type TurnstileResult = { success: boolean; hostname?: string; action?: string };
type Env = {
  APP_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  TURNSTILE_SECRET: string;
  BOOTSTRAP_ADMIN_EMAILS?: string;
  PUBLISH_DB: D1Database;
  PUBLICATIONS: R2Bucket;
  AUTH_LIMIT: RateLimit;
  PUBLIC_READ_LIMIT: RateLimit;
  MUTATION_IP_LIMIT: RateLimit;
  MUTATION_USER_LIMIT: RateLimit;
  /** Test seam; never configured in Wrangler. */
  __verifyTurnstile?: (token: string) => Promise<TurnstileResult | null>;
};
type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };
type User = {
  id: string;
  email: string;
  display_name: string | null;
  role: "member" | "admin";
  status: "active" | "suspended";
};
type PublicationRow = {
  publication_id: string;
  status: "published" | "unpublished" | "deleted";
  version: number;
  hash: string;
  updated_at: number;
  current_bytes: number;
};

const encoder = new TextEncoder();
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const STATE_MS = 10 * 60 * 1000;
const EXCHANGE_MS = 60 * 1000;
const RETAINED_VERSION_MS = 7 * 24 * 60 * 60 * 1000;
const AUDIT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const ALLOWED_TYPES = new Set(["note", "journey", "wireframe"]);

function randomBase64Url(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function publicationId(): string {
  const bytes = new Uint8Array(17); crypto.getRandomValues(bytes);
  let bits = 0, count = 0, result = "";
  for (const byte of bytes) { bits = (bits << 8) | byte; count += 8; while (count >= 5 && result.length < 26) { result += "0123456789abcdefghijklmnopqrstuv"[(bits >>> (count - 5)) & 31]; count -= 5; } }
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
  return !value || value.length > 200 || !value.startsWith("/") || value.startsWith("//") || /[:\\?#@\s\x00-\x1f\x7f]/.test(value) ? "/" : value;
}
function googleConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_SECRET && /^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(env.GOOGLE_CLIENT_ID));
}
function email(value: string): string { return value.trim().toLowerCase(); }
function bootstrapAdmin(env: Env, value: string): boolean {
  return (env.BOOTSTRAP_ADMIN_EMAILS ?? "").split(",").map(email).includes(email(value));
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
  const headers = cors(request, env, isPublic); headers.set("Content-Type", "application/json; charset=utf-8"); headers.set("Cache-Control", "no-store"); headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers });
}
function error(request: Request, env: Env, code: PublishErrorCode, message?: string, isPublic = false): Response {
  return response(request, env, { error: code, ...(message ? { message } : {}) }, ERROR_STATUS[code], isPublic);
}
/**
 * OAuth callbacks need to return to the app rather than leave the user on a JSON error page.
 * The route was validated when the OAuth state was created; safeReturn is repeated here so this
 * redirect remains safe if this callback's state handling changes later.
 */
function authErrorRedirect(env: Env, code: PublishErrorCode, returnPath: string): Response {
  const redirect = new URL("/", env.APP_ORIGIN);
  redirect.hash = new URLSearchParams({ auth_error: code, return: safeReturn(returnPath) }).toString();
  return Response.redirect(redirect.toString(), 302);
}
async function parseJson(request: Request): Promise<unknown | Response> {
  const body = await request.arrayBuffer();
  if (body.byteLength > LIMITS.payloadBytes) return new Response(null, { status: 413 });
  try { return JSON.parse(new TextDecoder().decode(body)); } catch { return null; }
}
async function allowed(limit: RateLimit, key: string): Promise<boolean> { return (await limit.limit({ key })).success; }
function ip(request: Request): string { return request.headers.get("CF-Connecting-IP") ?? "unknown"; }
async function sessionUser(request: Request, env: Env): Promise<User | null> {
  const token = request.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]{20,500})$/)?.[1];
  if (!token) return null;
  return await env.PUBLISH_DB.prepare("SELECT users.id, users.email, users.display_name, users.role, users.status FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?").bind(await sha256(token), Date.now()).first<User>();
}
function snapshotKey(id: string, version: number): string { return `publications/${id}/v${version}/scape.json`; }
function publicUrl(env: Env, id: string): string { return `${env.APP_ORIGIN}/p/${id}`; }
function asPublication(env: Env, row: PublicationRow) { return publicationSchema.parse({ publicationId: row.publication_id, hash: row.hash, version: row.version, status: row.status, url: publicUrl(env, row.publication_id), updatedAt: row.updated_at }); }
async function readOwnerPublication(env: Env, id: string, userId: string): Promise<PublicationRow | null> { return env.PUBLISH_DB.prepare("SELECT publication_id, status, version, hash, updated_at, current_bytes FROM publications WHERE publication_id = ? AND owner_id = ?").bind(id, userId).first<PublicationRow>(); }
async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<void> { let cursor: string | undefined; do { const listed = await bucket.list({ prefix, cursor }); if (listed.objects.length) await bucket.delete(listed.objects.map((object) => object.key)); cursor = listed.truncated ? listed.cursor : undefined; } while (cursor); }
/** `0` means a pre-quota row whose R2 size has not been measured yet; a valid snapshot is never empty. */
async function hydrateBytes(env: Env, rows: Array<Pick<PublicationRow, "publication_id" | "version" | "current_bytes">>): Promise<boolean> {
  const unknown = rows.filter((row) => row.current_bytes === 0);
  for (const row of unknown) {
    const object = await env.PUBLICATIONS.head(snapshotKey(row.publication_id, row.version));
    // Failing closed is intentional: accepting a write while an older retained snapshot cannot
    // be measured would turn a migration gap into unbounded storage.
    if (!object) return false;
    await env.PUBLISH_DB.prepare("UPDATE publications SET current_bytes = ? WHERE publication_id = ? AND current_bytes = 0").bind(object.size, row.publication_id).run();
  }
  return true;
}
async function hydrateAccountBytes(env: Env, ownerId: string): Promise<boolean> {
  const rows = (await env.PUBLISH_DB.prepare("SELECT publication_id, version, current_bytes FROM publications WHERE owner_id = ? AND status != 'deleted' AND current_bytes = 0").bind(ownerId).all<Pick<PublicationRow, "publication_id" | "version" | "current_bytes">>()).results;
  return hydrateBytes(env, rows);
}
async function verifyTurnstile(token: string, request: Request, env: Env): Promise<boolean> {
  let result: TurnstileResult | null;
  if (env.__verifyTurnstile) result = await env.__verifyTurnstile(token);
  else {
    if (!env.TURNSTILE_SECRET) return false;
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip(request) });
    result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }).then((r) => r.json() as Promise<TurnstileResult>).catch(() => null);
  }
  return Boolean(result?.success && result.hostname === new URL(env.APP_ORIGIN).hostname && result.action === "publish-auth");
}

async function authStart(request: Request, env: Env): Promise<Response> {
  if (!googleConfigured(env)) return error(request, env, "server_error", "Google sign-in is not configured yet.");
  const payload = await parseJson(request); if (payload instanceof Response) return error(request, env, "too_large");
  const parsed = authStartRequestSchema.safeParse(payload); if (!parsed.success || !(await verifyTurnstile(parsed.data.turnstileToken, request, env))) return error(request, env, "bot_check_failed", "Complete the security check and try again.");
  const state = randomBase64Url(), verifier = randomBase64Url(), now = Date.now();
  await env.PUBLISH_DB.prepare("INSERT INTO oauth_states (state, code_verifier, return_path, expires_at) VALUES (?, ?, ?, ?)").bind(state, verifier, safeReturn(parsed.data.return ?? null), now + STATE_MS).run();
  const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  google.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${new URL(request.url).origin}/auth/callback`, response_type: "code", scope: "openid email profile", state, code_challenge: await pkceChallenge(verifier), code_challenge_method: "S256", prompt: "select_account" }).toString();
  return response(request, env, authStartSchema.parse({ authorizationUrl: google.toString() }));
}

async function authCallback(request: Request, env: Env): Promise<Response> {
  if (!googleConfigured(env)) return error(request, env, "server_error", "Google sign-in is not configured yet.");
  const url = new URL(request.url), state = url.searchParams.get("state"), code = url.searchParams.get("code");
  if (!state || !code) return error(request, env, "unauthorized", "Google sign-in was cancelled.");
  const pending = await env.PUBLISH_DB.prepare("DELETE FROM oauth_states WHERE state = ? AND expires_at > ? RETURNING code_verifier, return_path").bind(state, Date.now()).first<{ code_verifier: string; return_path: string }>();
  if (!pending) return error(request, env, "unauthorized", "Sign-in session expired. Please try again.");
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${url.origin}/auth/callback`, grant_type: "authorization_code", code_verifier: pending.code_verifier }) });
  if (!tokenResponse.ok) return error(request, env, "unauthorized", "Google could not complete sign-in.");
  const token = await tokenResponse.json() as { id_token?: string }; if (!token.id_token) return error(request, env, "unauthorized", "Google did not return an identity token.");
  let claims: { sub: string; email: string; name?: string; email_verified?: boolean };
  try { claims = (await jwtVerify(token.id_token, googleKeys, { audience: env.GOOGLE_CLIENT_ID, issuer: ["https://accounts.google.com", "accounts.google.com"] })).payload as typeof claims; } catch { return error(request, env, "unauthorized", "Google identity verification failed."); }
  if (!claims.sub || !claims.email || claims.email_verified !== true) return error(request, env, "unauthorized", "A verified Google email is required.");
  const normalEmail = email(claims.email), now = Date.now(), userId = `usr_${await sha256(claims.sub)}`;
  let user = await env.PUBLISH_DB.prepare("SELECT id, email, display_name, role, status FROM users WHERE google_sub = ?").bind(claims.sub).first<User>();
  if (!user) {
    const role = bootstrapAdmin(env, normalEmail) ? "admin" : "member";
    // D1 batches are transactions. Claiming an invite and creating its user in one batch means
    // two simultaneous callbacks cannot both consume the same invite, nor leave it consumed if
    // creation fails. Bootstrap admins intentionally bypass the invite claim once.
    if (role === "admin") {
      await env.PUBLISH_DB.prepare("INSERT INTO users (id, google_sub, email, display_name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)").bind(userId, claims.sub, normalEmail, claims.name?.slice(0, 200) ?? null, role, now, now).run();
    } else {
      await env.PUBLISH_DB.batch([
        env.PUBLISH_DB.prepare("UPDATE invites SET status = 'accepted', accepted_at = ?, accepted_user_id = ? WHERE email = ? AND status = 'pending'").bind(now, userId, normalEmail),
        env.PUBLISH_DB.prepare("INSERT INTO users (id, google_sub, email, display_name, role, status, created_at, updated_at) SELECT ?, ?, ?, ?, 'member', 'active', ?, ? WHERE EXISTS (SELECT 1 FROM invites WHERE email = ? AND status = 'accepted' AND accepted_user_id = ?)").bind(userId, claims.sub, normalEmail, claims.name?.slice(0, 200) ?? null, now, now, normalEmail, userId),
      ]);
    }
    user = await env.PUBLISH_DB.prepare("SELECT id, email, display_name, role, status FROM users WHERE google_sub = ?").bind(claims.sub).first<User>();
    if (!user) return authErrorRedirect(env, "invite_required", pending.return_path);
  }
  if (user.status !== "active") return error(request, env, "account_suspended", "This account is suspended.");
  const sessionId = `ses_${randomBase64Url(18)}`, sessionSeed = randomBase64Url(), exchange = randomBase64Url();
  await env.PUBLISH_DB.batch([
    env.PUBLISH_DB.prepare("UPDATE users SET email = ?, display_name = ?, updated_at = ? WHERE id = ?").bind(normalEmail, claims.name?.slice(0, 200) ?? null, now, user.id),
    env.PUBLISH_DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    env.PUBLISH_DB.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").bind(sessionId, user.id, await sha256(sessionSeed), now + SESSION_MS, now),
    env.PUBLISH_DB.prepare("INSERT INTO exchange_codes (code, session_id, expires_at) VALUES (?, ?, ?)").bind(exchange, sessionId, now + EXCHANGE_MS),
  ]);
  const redirect = new URL("/", env.APP_ORIGIN); redirect.hash = new URLSearchParams({ token: exchange, return: pending.return_path }).toString();
  return Response.redirect(redirect.toString(), 302);
}

async function authExchange(request: Request, env: Env): Promise<Response> {
  const payload = await parseJson(request); if (payload instanceof Response) return error(request, env, "too_large");
  const code = typeof (payload as { token?: unknown } | null)?.token === "string" ? (payload as { token: string }).token : "";
  if (!/^[A-Za-z0-9_-]{20,500}$/.test(code)) return error(request, env, "unauthorized");
  const exchange = await env.PUBLISH_DB.prepare("DELETE FROM exchange_codes WHERE code = ? AND expires_at > ? RETURNING session_id").bind(code, Date.now()).first<{ session_id: string }>();
  if (!exchange) return error(request, env, "unauthorized", "Sign-in code expired. Please try again.");
  const row = await env.PUBLISH_DB.prepare("SELECT sessions.expires_at, users.email, users.display_name, users.role, users.status FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id = ?").bind(exchange.session_id).first<{ expires_at: number; email: string; display_name: string | null; role: string; status: string }>();
  if (!row) return error(request, env, "unauthorized"); if (row.status !== "active") return error(request, env, "account_suspended", "This account is suspended.");
  const token = randomBase64Url(); await env.PUBLISH_DB.prepare("UPDATE sessions SET token_hash = ? WHERE id = ?").bind(await sha256(token), exchange.session_id).run();
  return response(request, env, { token, expiresAt: row.expires_at, email: row.email, ...(row.display_name ? { name: row.display_name } : {}), isAdmin: row.role === "admin" });
}

async function consumeWrite(env: Env, userId: string, now: number): Promise<boolean> {
  const day = Math.floor(now / 86_400_000);
  const row = await env.PUBLISH_DB.prepare("INSERT INTO publish_usage (owner_id, day, writes) VALUES (?, ?, 1) ON CONFLICT(owner_id, day) DO UPDATE SET writes = writes + 1 WHERE writes < ? RETURNING writes").bind(userId, day, DAILY_WRITE_LIMIT).first<{ writes: number }>();
  return Boolean(row);
}
async function refundWrite(env: Env, userId: string, now: number): Promise<void> { await env.PUBLISH_DB.prepare("UPDATE publish_usage SET writes = MAX(writes - 1, 0) WHERE owner_id = ? AND day = ?").bind(userId, Math.floor(now / 86_400_000)).run(); }
async function publish(request: Request, env: Env, user: User, id?: string): Promise<Response> {
  const payload = await parseJson(request); if (payload instanceof Response) return error(request, env, "too_large");
  const parsed = publishRequestSchema.safeParse(payload);
  if (!parsed.success || parsed.data.scape.objects.some((object) => !ALLOWED_TYPES.has(object.type))) return error(request, env, "invalid_projection");
  const scape: PublishedScape = { ...parsed.data.scape, relationships: parsed.data.scape.relationships.filter((edge) => parsed.data.scape.objects.some((object) => object.id === edge.from) && parsed.data.scape.objects.some((object) => object.id === edge.to)) };
  const snapshot = JSON.stringify(scape), bytes = encoder.encode(snapshot).byteLength, hash = await canonicalHash(scape), now = Date.now();
  if (id) {
    if (!PUBLICATION_ID_PATTERN.test(id)) return error(request, env, "not_found");
    if (!(await hydrateAccountBytes(env, user.id))) return error(request, env, "server_error", "A stored publication could not be measured safely.");
    const existing = await readOwnerPublication(env, id, user.id); if (!existing) return error(request, env, "not_found"); if (existing.status !== "published") return error(request, env, "unpublished");
    if (existing.hash === hash) return response(request, env, asPublication(env, existing));
    if (!(await consumeWrite(env, user.id, now))) return error(request, env, "daily_write_limit", "You have reached today’s publication update limit.");
    const version = existing.version + 1;
    try { await env.PUBLICATIONS.put(snapshotKey(id, version), snapshot, { httpMetadata: { contentType: "application/json" } }); } catch { await refundWrite(env, user.id, now); return error(request, env, "server_error"); }
    // The guard is in the UPDATE, not only a previous SELECT: concurrent updates cannot move
    // the account past its byte cap or overwrite a newer version.
    const updated = await env.PUBLISH_DB.prepare("UPDATE publications SET version = ?, hash = ?, current_bytes = ?, updated_at = ? WHERE publication_id = ? AND owner_id = ? AND status = 'published' AND version = ? AND (SELECT COALESCE(SUM(current_bytes), 0) FROM publications WHERE owner_id = ? AND status != 'deleted') - current_bytes + ? <= ? RETURNING publication_id").bind(version, hash, bytes, now, id, user.id, existing.version, user.id, bytes, ACCOUNT_STORAGE_LIMIT).first<{ publication_id: string }>();
    if (!updated) { await env.PUBLICATIONS.delete(snapshotKey(id, version)); await refundWrite(env, user.id, now); const current = await readOwnerPublication(env, id, user.id); return current?.version !== existing.version ? error(request, env, "server_error", "This publication changed. Refresh and try again.") : error(request, env, "storage_limit", "This account has reached its publication storage limit."); }
    await env.PUBLISH_DB.prepare("INSERT OR REPLACE INTO superseded_versions (publication_id, version, delete_after) VALUES (?, ?, ?)").bind(id, existing.version, now + RETAINED_VERSION_MS).run();
    return response(request, env, asPublication(env, { ...existing, version, hash, current_bytes: bytes, updated_at: now }));
  }
  if (!(await hydrateAccountBytes(env, user.id))) return error(request, env, "server_error", "A stored publication could not be measured safely.");
  if (!(await consumeWrite(env, user.id, now))) return error(request, env, "daily_write_limit", "You have reached today’s publication update limit.");
  const newId = publicationId();
  // This conditional INSERT makes the retained-slot and byte limits authoritative even if two
  // requests pass the browser-side UI at the same instant.
  const created = await env.PUBLISH_DB.prepare("INSERT INTO publications (publication_id, owner_id, status, version, hash, current_bytes, updated_at, created_at) SELECT ?, ?, 'published', 1, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM publications WHERE owner_id = ? AND status != 'deleted') < ? AND (SELECT COALESCE(SUM(current_bytes), 0) FROM publications WHERE owner_id = ? AND status != 'deleted') + ? <= ? RETURNING publication_id").bind(newId, user.id, hash, bytes, now, now, user.id, PUBLICATION_LIMIT, user.id, bytes, ACCOUNT_STORAGE_LIMIT).first<{ publication_id: string }>();
  if (!created) { await refundWrite(env, user.id, now); const usage = await env.PUBLISH_DB.prepare("SELECT COUNT(*) AS slots, COALESCE(SUM(current_bytes), 0) AS bytes FROM publications WHERE owner_id = ? AND status != 'deleted'").bind(user.id).first<{ slots: number; bytes: number }>(); return (usage?.slots ?? 0) >= PUBLICATION_LIMIT ? error(request, env, "quota_exceeded", "You have used all 50 publication slots. Delete one to free a slot.") : error(request, env, "storage_limit", "This account has reached its publication storage limit."); }
  try { await env.PUBLICATIONS.put(snapshotKey(newId, 1), snapshot, { httpMetadata: { contentType: "application/json" } }); }
  catch { await env.PUBLISH_DB.prepare("DELETE FROM publications WHERE publication_id = ? AND owner_id = ?").bind(newId, user.id).run(); await refundWrite(env, user.id, now); return error(request, env, "server_error"); }
  return response(request, env, asPublication(env, { publication_id: newId, status: "published", version: 1, hash, current_bytes: bytes, updated_at: now }), 201);
}

async function audit(env: Env, actor: User, action: string, target: string, detail?: Record<string, unknown>): Promise<void> { await env.PUBLISH_DB.prepare("INSERT INTO admin_audit (actor_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)").bind(actor.id, action, target, detail ? JSON.stringify(detail) : null, Date.now()).run(); }
function admin(request: Request, env: Env, user: User | null): Response | null { if (!user) return error(request, env, "unauthorized"); if (user.status !== "active") return error(request, env, "account_suspended"); return user.role === "admin" ? null : error(request, env, "admin_required"); }
async function handleAdmin(request: Request, env: Env, user: User, url: URL): Promise<Response> {
  const guard = admin(request, env, user); if (guard) return guard;
  if (request.method === "GET" && url.pathname === "/admin") {
    const cursor = Number(url.searchParams.get("cursor")); const before = Number.isSafeInteger(cursor) && cursor > 0 ? cursor : Date.now() + 1; const pageSize = 50;
    const inviteRows = (await env.PUBLISH_DB.prepare("SELECT email, status, created_at, accepted_at FROM invites WHERE created_at < ? ORDER BY created_at DESC LIMIT ?").bind(before, pageSize).all<{ email: string; status: "pending" | "accepted" | "revoked"; created_at: number; accepted_at: number | null }>()).results;
    const memberRows = (await env.PUBLISH_DB.prepare("SELECT id, email, display_name, role, status, created_at FROM users WHERE created_at < ? ORDER BY created_at DESC LIMIT ?").bind(before, pageSize).all<{ id: string; email: string; display_name: string | null; role: "member" | "admin"; status: "active" | "suspended"; created_at: number }>()).results;
    const invites = inviteRows.map((row) => ({ email: row.email, status: row.status, createdAt: row.created_at, acceptedAt: row.accepted_at }));
    const members = memberRows.map((row) => ({ id: row.id, email: row.email, name: row.display_name, role: row.role, status: row.status, createdAt: row.created_at }));
    const nextCursor = inviteRows.length === pageSize || memberRows.length === pageSize ? Math.min(...[...inviteRows, ...memberRows].map((row) => row.created_at)) : null;
    return response(request, env, adminListSchema.parse({ invites, members, nextCursor }));
  }
  if (request.method === "POST" && url.pathname === "/admin/invites") {
    const payload = await parseJson(request); if (payload instanceof Response) return error(request, env, "too_large"); const value = typeof (payload as { email?: unknown })?.email === "string" ? email((payload as { email: string }).email) : "";
    if (!/^.{1,320}@[^\s@]+\.[^\s@]+$/.test(value)) return error(request, env, "invalid_projection", "Enter a valid email address.");
    await env.PUBLISH_DB.prepare("INSERT INTO invites (email, status, created_by, created_at) VALUES (?, 'pending', ?, ?) ON CONFLICT(email) DO UPDATE SET status = 'pending', created_by = excluded.created_by, created_at = excluded.created_at, accepted_at = NULL, accepted_user_id = NULL WHERE invites.status = 'revoked'").bind(value, user.id, Date.now()).run(); await audit(env, user, "invite.created", value); return response(request, env, { ok: true }, 201);
  }
  const invite = url.pathname.match(/^\/admin\/invites\/([^/]+)$/);
  if (request.method === "DELETE" && invite) { const value = email(decodeURIComponent(invite[1])); await env.PUBLISH_DB.prepare("UPDATE invites SET status = 'revoked' WHERE email = ? AND status = 'pending'").bind(value).run(); await audit(env, user, "invite.revoked", value); return new Response(null, { status: 204, headers: cors(request, env) }); }
  const member = url.pathname.match(/^\/admin\/members\/([^/]+)\/(suspend|restore)$/);
  if (request.method === "POST" && member) { const [, target, operation] = member; if (target === user.id) return error(request, env, "invalid_projection", "You cannot suspend your own admin account."); const targetUser = await env.PUBLISH_DB.prepare("SELECT role FROM users WHERE id = ?").bind(target).first<{ role: string }>(); if (!targetUser) return error(request, env, "not_found"); if (targetUser.role === "admin") return error(request, env, "admin_required", "Administrator accounts cannot be suspended here."); const status = operation === "suspend" ? "suspended" : "active"; await env.PUBLISH_DB.prepare("UPDATE users SET status = ? WHERE id = ?").bind(status, target).run(); await audit(env, user, `member.${operation}`, target); return response(request, env, { ok: true }); }
  return error(request, env, "not_found");
}

async function handle(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url); const publicMatch = url.pathname.match(/^\/p\/(pub_[0-9a-z]{26})(?:\/v(\d+)\/scape\.json)?$/); const mutation = request.method !== "GET" && request.method !== "OPTIONS";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request, env, !!publicMatch) });
  if (publicMatch) {
    if (!(await allowed(env.PUBLIC_READ_LIMIT, ip(request)))) return error(request, env, "rate_limited", undefined, true);
    const [, id, version] = publicMatch; const row = await env.PUBLISH_DB.prepare("SELECT publication_id, status, version, hash, updated_at, current_bytes FROM publications WHERE publication_id = ?").bind(id).first<PublicationRow>();
    if (!row || row.status === "deleted") return error(request, env, "not_found", undefined, true); if (row.status === "unpublished") return error(request, env, "unpublished", undefined, true);
    if (version) { if (Number(version) !== row.version) return error(request, env, "not_found", undefined, true); const object = await env.PUBLICATIONS.get(snapshotKey(id, row.version)); if (!object) return error(request, env, "not_found", undefined, true); const headers = cors(request, env, true); headers.set("Content-Type", "application/json; charset=utf-8"); headers.set("Cache-Control", "public, max-age=31536000, immutable"); headers.set("X-Content-Type-Options", "nosniff"); return new Response(object.body, { headers }); }
    return response(request, env, publicationPointerSchema.parse({ publicationId: id, version: row.version, hash: row.hash, snapshotPath: `/p/${id}/v${row.version}/scape.json`, updatedAt: row.updated_at }), 200, true);
  }
  if (mutation && request.headers.get("Origin") !== env.APP_ORIGIN) return error(request, env, "unauthorized");
  if (request.method === "POST" && url.pathname === "/auth/start") { if (!(await allowed(env.AUTH_LIMIT, ip(request)))) return error(request, env, "rate_limited"); return authStart(request, env); }
  if (request.method === "GET" && url.pathname === "/auth/callback") { if (!(await allowed(env.AUTH_LIMIT, ip(request)))) return error(request, env, "rate_limited"); return authCallback(request, env); }
  if (request.method === "POST" && url.pathname === "/auth/exchange") { if (!(await allowed(env.AUTH_LIMIT, ip(request)))) return error(request, env, "rate_limited"); return authExchange(request, env); }
  const user = await sessionUser(request, env); if (!user) return error(request, env, "unauthorized"); if (user.status !== "active") return error(request, env, "account_suspended", "This account is suspended.");
  if (mutation && (!(await allowed(env.MUTATION_IP_LIMIT, ip(request))) || !(await allowed(env.MUTATION_USER_LIMIT, user.id)))) return error(request, env, "rate_limited");
  if (url.pathname.startsWith("/admin")) return handleAdmin(request, env, user, url);
  if (request.method === "POST" && url.pathname === "/auth/logout") { await env.PUBLISH_DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run(); return new Response(null, { status: 204, headers: cors(request, env) }); }
  if (request.method === "DELETE" && url.pathname === "/account") { const ids = (await env.PUBLISH_DB.prepare("SELECT publication_id FROM publications WHERE owner_id = ?").bind(user.id).all<{ publication_id: string }>()).results; await Promise.all(ids.map((row) => deletePrefix(env.PUBLICATIONS, `publications/${row.publication_id}/`))); await env.PUBLISH_DB.batch([env.PUBLISH_DB.prepare("DELETE FROM exchange_codes WHERE session_id IN (SELECT id FROM sessions WHERE user_id = ?)").bind(user.id), env.PUBLISH_DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id), env.PUBLISH_DB.prepare("DELETE FROM superseded_versions WHERE publication_id IN (SELECT publication_id FROM publications WHERE owner_id = ?)").bind(user.id), env.PUBLISH_DB.prepare("DELETE FROM publications WHERE owner_id = ?").bind(user.id), env.PUBLISH_DB.prepare("DELETE FROM publish_usage WHERE owner_id = ?").bind(user.id), env.PUBLISH_DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id)]); return new Response(null, { status: 204, headers: cors(request, env) }); }
  if (request.method === "GET" && url.pathname === "/publications") { const rows = (await env.PUBLISH_DB.prepare("SELECT publication_id, status, version, hash, updated_at, current_bytes FROM publications WHERE owner_id = ? AND status != 'deleted' ORDER BY updated_at DESC").bind(user.id).all<PublicationRow>()).results; const activeUsed = rows.filter((row) => row.status === "published").length; const storedBytes = rows.reduce((sum, row) => sum + row.current_bytes, 0); return response(request, env, publicationListSchema.parse({ publications: rows.map((row) => asPublication(env, row)), limit: PUBLICATION_LIMIT, used: rows.length, activeUsed, storedBytes })); }
  if (request.method === "POST" && url.pathname === "/publications") return publish(request, env, user);
  const match = url.pathname.match(/^\/publications\/(pub_[0-9a-z]{26})(?:\/(unpublish|republish))?$/); if (!match) return error(request, env, "not_found"); const [, id, action] = match;
  if (request.method === "PUT" && !action) return publish(request, env, user, id);
  const existing = await readOwnerPublication(env, id, user.id); if (!existing) return error(request, env, "not_found");
  if (request.method === "POST" && action === "unpublish") { if (existing.status !== "published") return error(request, env, "unpublished"); const now = Date.now(); await env.PUBLISH_DB.prepare("UPDATE publications SET status = 'unpublished', updated_at = ? WHERE publication_id = ? AND owner_id = ?").bind(now, id, user.id).run(); return response(request, env, asPublication(env, { ...existing, status: "unpublished", updated_at: now })); }
  if (request.method === "POST" && action === "republish") { if (existing.status !== "unpublished") return error(request, env, "invalid_projection"); const now = Date.now(); await env.PUBLISH_DB.prepare("UPDATE publications SET status = 'published', updated_at = ? WHERE publication_id = ? AND owner_id = ?").bind(now, id, user.id).run(); return response(request, env, asPublication(env, { ...existing, status: "published", updated_at: now })); }
  if (request.method === "DELETE" && !action) { await deletePrefix(env.PUBLICATIONS, `publications/${id}/`); await env.PUBLISH_DB.prepare("UPDATE publications SET status = 'deleted', current_bytes = 0, updated_at = ? WHERE publication_id = ? AND owner_id = ?").bind(Date.now(), id, user.id).run(); return new Response(null, { status: 204, headers: cors(request, env) }); }
  return error(request, env, "not_found");
}

async function sweep(env: Env): Promise<void> {
  const now = Date.now(); const due = (await env.PUBLISH_DB.prepare("SELECT publication_id, version FROM superseded_versions WHERE delete_after <= ?").bind(now).all<{ publication_id: string; version: number }>()).results;
  await Promise.all(due.map(async (row) => { await env.PUBLICATIONS.delete(snapshotKey(row.publication_id, row.version)); await env.PUBLISH_DB.prepare("DELETE FROM superseded_versions WHERE publication_id = ? AND version = ?").bind(row.publication_id, row.version).run(); }));
  await env.PUBLISH_DB.batch([env.PUBLISH_DB.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").bind(now), env.PUBLISH_DB.prepare("DELETE FROM exchange_codes WHERE expires_at <= ?").bind(now), env.PUBLISH_DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now), env.PUBLISH_DB.prepare("DELETE FROM publish_usage WHERE day < ?").bind(Math.floor(now / 86_400_000) - 2), env.PUBLISH_DB.prepare("DELETE FROM admin_audit WHERE created_at <= ?").bind(now - AUDIT_RETENTION_MS)]);
  // Existing rows predate `current_bytes`; backfill a bounded batch every hour so rollout does
  // not require a one-off script with broad R2 credentials.
  const legacy = (await env.PUBLISH_DB.prepare("SELECT publication_id, version, current_bytes FROM publications WHERE status != 'deleted' AND current_bytes = 0 LIMIT 50").all<Pick<PublicationRow, "publication_id" | "version" | "current_bytes">>()).results;
  await hydrateBytes(env, legacy);
}

export default { fetch: (request: Request, env: Env, ctx: ExecutionContext) => handle(request, env, ctx), scheduled: (_event: ScheduledEvent, env: Env) => sweep(env) };
export { safeReturn };
