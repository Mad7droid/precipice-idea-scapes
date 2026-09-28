import type { Env } from "./index";
const TTL = 90 * 86400_000;
export const digest = async (text: string) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
};
export const random = () =>
  [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
export async function issueHost(env: Env, userId: string, host: "web" | "desktop") {
  const token = random();
  const expiresAt = Date.now() + TTL;
  await env.PUBLISH_DB.prepare("DELETE FROM mcp_hosts WHERE expires_at <= ?")
    .bind(Date.now())
    .run();
  await env.PUBLISH_DB.prepare("INSERT INTO mcp_hosts VALUES (?, ?, ?, ?)")
    .bind(await digest(token), userId, host, expiresAt)
    .run();
  return { token, expiresAt };
}
export async function hostUser(request: Request, env: Env) {
  const token = request.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) return null;
  const hash = await digest(token);
  const row = await env.PUBLISH_DB.prepare(
    "SELECT users.id, users.email, users.status, mcp_hosts.host, mcp_hosts.expires_at FROM mcp_hosts JOIN users ON users.id = mcp_hosts.user_id WHERE token_hash = ? AND expires_at > ?",
  )
    .bind(hash, Date.now())
    .first<{
      id: string;
      email: string;
      status: string;
      host: "web" | "desktop";
      expires_at: number;
    }>();
  // Extend only on activity, at most once a week, with no timer or background polling.
  if (row && row.expires_at < Date.now() + TTL - 7 * 86400_000)
    await env.PUBLISH_DB.prepare("UPDATE mcp_hosts SET expires_at = ? WHERE token_hash = ?")
      .bind(Date.now() + TTL, hash)
      .run();
  return row;
}
export async function approveHost(env: Env, userId: string, challenge: unknown) {
  if (typeof challenge !== "string" || !/^[a-f0-9]{64}$/.test(challenge)) return null;
  const code = random();
  await env.PUBLISH_DB.prepare("DELETE FROM mcp_host_codes WHERE expires_at <= ?")
    .bind(Date.now())
    .run();
  await env.PUBLISH_DB.prepare("INSERT INTO mcp_host_codes VALUES (?, ?, ?, ?)")
    .bind(code, userId, challenge, Date.now() + 60_000)
    .run();
  return `precipice://auth/callback?code=${code}`;
}
export async function exchangeHost(env: Env, input: unknown) {
  if (!input || typeof input !== "object") return null;
  const body = input as { code?: unknown; verifier?: unknown };
  if (
    typeof body.code !== "string" ||
    typeof body.verifier !== "string" ||
    !/^[a-f0-9]{64}$/.test(body.verifier) ||
    !/^[a-f0-9]{64}$/.test(body.code)
  )
    return null;
  const row = await env.PUBLISH_DB.prepare(
    "DELETE FROM mcp_host_codes WHERE code = ? AND challenge = ? AND expires_at > ? RETURNING user_id",
  )
    .bind(body.code, await digest(body.verifier), Date.now())
    .first<{ user_id: string }>();
  if (!row) return null;
  const user = await env.PUBLISH_DB.prepare("SELECT status FROM users WHERE id = ?")
    .bind(row.user_id)
    .first<{ status: string }>();
  if (user?.status !== "active") return null;
  return issueHost(env, row.user_id, "desktop");
}
/** Signs out the one host presenting this credential; other hosts stay connected. */
export async function revokeHost(env: Env, request: Request) {
  const token = request.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) return;
  await env.PUBLISH_DB.prepare("DELETE FROM mcp_hosts WHERE token_hash = ?")
    .bind(await digest(token))
    .run();
}
