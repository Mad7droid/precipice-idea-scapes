import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { IncomingMessage } from "node:http";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Plugin } from "vite";

const AUTH = "https://auth.openai.com";
const API = "https://api.openai.com/v1";
const COOKIE = "precipice_chatgpt_local";
const random = () => randomBytes(32).toString("base64url");
const hash = (text: string) => createHash("sha256").update(text).digest("base64url");
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const jwks = createRemoteJWKSet(new URL(`${AUTH}/.well-known/jwks.json`));
interface Tokens {
  access_token: string;
  refresh_token?: string;
  id_token: string;
  scope: string;
  expires_in: number;
  earliest_refresh_at?: number;
  token_type?: string;
}
interface Saved {
  host: string;
  cookieHash: string;
  client: string;
  subject: string;
  email: string;
  tokens: Tokens;
  expiresAt: number;
  models: { id: string; label: string }[];
}
interface Pending {
  state: string;
  nonce: string;
  verifier: string;
  redirect: string;
  expires: number;
  client?: string;
  subject?: string;
  used?: boolean;
}

export function authorizationUrl(host: string, pending: Pending) {
  const url = new URL(`${AUTH}/api/accounts/authorize`);
  url.search = new URLSearchParams({
    client_id: pending.client ?? "dynamic_agent_client",
    ext_agent_host_id: host,
    ...(pending.client ? {} : { agent_name_hint: "Precipice" }),
    response_type: "code",
    redirect_uri: pending.redirect,
    scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    resource: API,
    state: pending.state,
    nonce: pending.nonce,
    code_challenge_method: "S256",
    code_challenge: hash(pending.verifier),
  }).toString();
  return url.toString();
}

export function callbackClient(url: URL, pending: Pending) {
  if (Date.now() > pending.expires || !equal(url.searchParams.get("state") ?? "", pending.state))
    throw new Error("Invalid or expired sign-in attempt. Start again.");
  if (url.searchParams.has("error"))
    throw new Error("Sign-in was cancelled or permission was declined. Try again when ready.");
  const client = url.searchParams.get("client_id") ?? pending.client;
  if (!client || client === "dynamic_agent_client" || (pending.client && pending.client !== client))
    throw new Error("Registration did not return the expected client identity. Start again.");
  const code = url.searchParams.get("code");
  if (!code) throw new Error("Sign-in returned no authorization code. Start again.");
  return { client, code };
}

export function validateTokens(raw: unknown): Tokens {
  const value = raw as Tokens | null;
  if (
    !value ||
    typeof value.access_token !== "string" ||
    !value.access_token ||
    (value.refresh_token !== undefined && typeof value.refresh_token !== "string") ||
    typeof value.scope !== "string" ||
    !Number.isFinite(value.expires_in) ||
    value.expires_in <= 0 ||
    value.token_type?.toLowerCase() !== "bearer" ||
    !value.scope.split(/\s+/).includes("chatgpt.tokens.use.direct")
  ) {
    throw new Error("ChatGPT plan permission was not granted. Reconnect and authorize plan usage.");
  }
  return value;
}

export async function validateIdentity(
  token: string,
  client: string,
  nonce: string,
  subject?: string,
  key: JWTVerifyGetKey = jwks,
) {
  const { payload } = await jwtVerify(token, key, {
    issuer: AUTH,
    audience: client,
    requiredClaims: ["sub", "exp", "nonce"],
  });
  if (payload.nonce !== nonce || !payload.sub || (subject && subject !== payload.sub))
    throw new Error("ChatGPT account did not match this sign-in. Start again.");
  return {
    ...payload,
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : "ChatGPT account",
  };
}

export function allowedLocalRequest(req: IncomingMessage, origin: string, mutation: boolean) {
  if (req.headers.host !== new URL(origin).host) return false;
  if (mutation) return req.headers.origin === origin;
  return !req.headers.origin || req.headers.origin === origin;
}

async function jsonBody(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 512 * 1024) throw new Error("Request too large.");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Local OSS development only. Never bundled into the hosted app or public BYOK Worker. */
export function chatgptLocal(
  options: {
    directory?: string;
    fetcher?: typeof fetch;
    verifyIdentity?: typeof validateIdentity;
  } = {},
): Plugin {
  const transport = options.fetcher ?? fetch;
  const verify = options.verifyIdentity ?? validateIdentity;
  return {
    name: "precipice-chatgpt-local",
    apply: "serve",
    configureServer(server) {
      const directory =
        options.directory ??
        resolve(
          homedir(),
          "Library/Application Support/Precipice/local-preview",
          hash(server.config.root),
        );
      const file = resolve(directory, "session.json");
      let saved: Saved | null = null;
      let registration: { client: string; subject: string } | null = null;
      let host = "";
      let error = "";
      let refresh: Promise<void> | null = null;
      const pending = new Map<string, Pending>();
      const streams = new Set<AbortController>();
      let generation = 0;
      let writes = Promise.resolve();
      const update = (work: () => Promise<void>) => {
        const result = writes.then(work, work);
        writes = result.catch(() => {});
        return result;
      };
      const ready = (async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        try {
          host = (await readFile(resolve(directory, "host"), "utf8")).trim();
        } catch {
          host = `urn:uuid:${crypto.randomUUID()}`;
          await writeFile(resolve(directory, "host"), host, { mode: 0o600, flag: "wx" });
        }
        try {
          registration = JSON.parse(
            await readFile(resolve(directory, "registration.json"), "utf8"),
          );
        } catch {
          registration = null;
        }
        try {
          saved = JSON.parse(await readFile(file, "utf8"));
        } catch {
          saved = null;
        }
      })();
      const persist = async (record: Saved) => {
        const temporary = `${file}.${random()}.tmp`;
        await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: "wx" });
        await rename(temporary, file);
      };
      const tokenExchange = async (params: Record<string, string>): Promise<Tokens> => {
        const response = await transport(`${AUTH}/api/accounts/oauth/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ ...params, resource: API }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok)
          throw new Error(
            "ChatGPT authorization expired or could not be completed. Reconnect to try again.",
          );
        return validateTokens(await response.json());
      };
      const current = async () => {
        if (!saved) throw new Error("Connect ChatGPT in Settings → AI first.");
        if (saved.expiresAt > Date.now() + 60_000) return saved;
        if (!refresh) {
          const record = saved;
          const epoch = generation;
          refresh = (async () => {
            if (!record.tokens.refresh_token)
              throw new Error("Reconnect ChatGPT to renew this session.");
            const tokens = await tokenExchange({
              grant_type: "refresh_token",
              client_id: record.client,
              refresh_token: record.tokens.refresh_token,
            });
            if (epoch !== generation) throw new Error("Connection changed. Please try again.");
            const next = {
              ...record,
              tokens: { ...record.tokens, ...tokens },
              expiresAt: Date.now() + tokens.expires_in * 1000,
            };
            await update(async () => {
              if (epoch !== generation) throw new Error("Connection changed. Please try again.");
              await persist(next);
              saved = next;
            });
          })().finally(() => {
            refresh = null;
          });
        }
        await refresh;
        if (!saved) throw new Error("ChatGPT was disconnected.");
        return saved;
      };
      server.httpServer?.once("close", () => {
        generation++;
        pending.clear();
        streams.forEach((stream) => stream.abort());
      });
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0];
        if (!path?.startsWith("/__chatgpt/")) return next();
        // This companion cannot be exposed by changing Vite's --host option.
        if (server.config.server.host !== "127.0.0.1" || !server.httpServer?.address()) {
          res.statusCode = 503;
          res.end("Start the dev server with --host 127.0.0.1.");
          return;
        }
        const address = server.httpServer.address();
        if (!address || typeof address === "string") return next();
        const origin = `http://127.0.0.1:${address.port}`;
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
        const send = (status: number, data: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(data));
        };
        const mutation = req.method !== "GET";
        if (!allowedLocalRequest(req, origin, mutation)) {
          send(403, { error: "This connection is restricted to its local Precipice origin." });
          return;
        }
        try {
          await ready;
          const cookie =
            /(?:^|;\s*)precipice_chatgpt_local=([A-Za-z0-9_-]+)/.exec(
              req.headers.cookie ?? "",
            )?.[1] ?? "";
          const authorized = !!saved && !!cookie && equal(hash(cookie), saved.cookieHash);
          if (path === "/__chatgpt/status" && req.method === "GET") {
            const attempt = pending.get(hash(cookie));
            send(200, {
              available: true,
              status: authorized
                ? "connected"
                : attempt && attempt.expires > Date.now()
                  ? "connecting"
                  : "disconnected",
              connectionId: authorized ? hash(`${saved!.subject}:${saved!.client}`) : undefined,
              email: authorized ? saved?.email : undefined,
              models: authorized ? saved?.models : [],
              error,
            });
            return;
          }
          if (path === "/__chatgpt/connect" && req.method === "POST") {
            const options = await jsonBody(req);
            const browser = cookie || random();
            // One pending attempt per browser; old attempts expire without exchanging tokens.
            for (const [key, attempt] of pending)
              if (attempt.expires < Date.now()) pending.delete(key);
            if (pending.size >= 20)
              throw new Error("Too many pending sign-ins. Try again in a few minutes.");
            const attempt: Pending = {
              state: random(),
              nonce: random(),
              verifier: random(),
              redirect: `${origin}/__chatgpt/callback`,
              expires: Date.now() + 5 * 60_000,
              ...(!options.newAccount && (authorized || registration)
                ? {
                    client: authorized ? saved!.client : registration!.client,
                    subject: authorized ? saved!.subject : registration!.subject,
                  }
                : {}),
            };
            pending.set(hash(browser), attempt);
            error = "";
            res.setHeader(
              "Set-Cookie",
              `${COOKIE}=${browser}; HttpOnly; SameSite=Lax; Path=/__chatgpt/`,
            );
            send(200, { url: authorizationUrl(host, attempt) });
            return;
          }
          if (path === "/__chatgpt/callback" && req.method === "GET") {
            const attempt = pending.get(hash(cookie));
            if (!attempt)
              throw new Error(
                "Sign-in attempt was cancelled or expired. Start again in Precipice.",
              );
            const { client, code } = callbackClient(new URL(req.url!, origin), attempt);
            if (attempt.used) throw new Error("Sign-in callback was already used. Start again.");
            attempt.used = true;
            const epoch = generation;
            const tokens = await tokenExchange({
              grant_type: "authorization_code",
              client_id: client,
              code,
              code_verifier: attempt.verifier,
              redirect_uri: attempt.redirect,
            });
            if (!tokens.id_token)
              throw new Error("ChatGPT returned no verified identity. Start again.");
            const payload = await verify(tokens.id_token, client, attempt.nonce, attempt.subject);
            const modelResponse = await transport(`${API}/models`, {
              headers: { authorization: `Bearer ${tokens.access_token}` },
              signal: AbortSignal.timeout(30_000),
            });
            if (!modelResponse.ok)
              throw new Error(
                "ChatGPT could not list models for this account. Reconnect to try again.",
              );
            const modelData = (await modelResponse.json()) as {
              models?: { slug: string; display_name: string; visibility: string }[];
            };
            const models = (modelData.models ?? [])
              .filter(
                (m) =>
                  m.visibility === "list" &&
                  typeof m.slug === "string" &&
                  typeof m.display_name === "string",
              )
              .map((m) => ({ id: `chatgpt/${m.slug}`, label: m.display_name }));
            if (!models.length)
              throw new Error("No eligible ChatGPT models are available for this account.");
            if (epoch !== generation) throw new Error("Sign-in was cancelled. Start again.");
            const record = {
              host,
              cookieHash: hash(cookie),
              client,
              subject: payload.sub,
              email: typeof payload.email === "string" ? payload.email : "ChatGPT account",
              tokens,
              expiresAt: Date.now() + tokens.expires_in * 1000,
              models,
            };
            await update(async () => {
              if (epoch !== generation || pending.get(hash(cookie)) !== attempt)
                throw new Error("Sign-in was cancelled. Start again.");
              await persist(record);
              registration = { client: record.client, subject: record.subject };
              await writeFile(
                resolve(directory, "registration.json"),
                JSON.stringify(registration),
                { mode: 0o600 },
              );
              saved = record;
              generation++;
              streams.forEach((stream) => stream.abort());
              pending.delete(hash(cookie));
              error = "";
            });
            // No tokens, codes or arbitrary destinations are reflected into the callback page.
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("ChatGPT connected. Return to Precipice and send your draft when ready.");
            return;
          }
          if (path === "/__chatgpt/disconnect" && req.method === "POST") {
            if (!authorized && !pending.has(hash(cookie))) {
              send(401, { error: "No active connection for this browser." });
              return;
            }
            if (authorized) {
              generation++;
              streams.forEach((stream) => stream.abort());
            }
            pending.delete(hash(cookie));
            if (authorized) {
              await update(async () => {
                saved = null;
                await rm(file, { force: true });
              });
            }
            error = "";
            res.setHeader(
              "Set-Cookie",
              `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/__chatgpt/; Max-Age=0`,
            );
            send(200, { ok: true });
            return;
          }
          if (!authorized) {
            send(401, { error: "Connect ChatGPT in Settings → AI first." });
            return;
          }
          if (path === "/__chatgpt/responses" && req.method === "POST") {
            const body = await jsonBody(req);
            const record = await current();
            if (body.connectionId !== hash(`${record.subject}:${record.client}`)) {
              send(409, {
                error: "ChatGPT account changed. Send the request again from the current account.",
              });
              return;
            }
            if (
              !record.models.some((m) => m.id === `chatgpt/${body.model}`) ||
              !Array.isArray(body.input)
            )
              throw new Error("Choose an available ChatGPT model and try again.");
            const abort = new AbortController();
            streams.add(abort);
            res.once("close", () => abort.abort());
            try {
              const upstream = await transport(`${API}/responses`, {
                method: "POST",
                headers: {
                  authorization: `Bearer ${record.tokens.access_token}`,
                  "content-type": "application/json",
                },
                // Allow only this integration's supported request fields; never forward arbitrary URLs/headers.
                body: JSON.stringify({
                  model: body.model,
                  instructions: body.instructions,
                  input: body.input,
                  tools: body.tools,
                  store: false,
                  stream: true,
                  include: ["reasoning.encrypted_content"],
                }),
                signal: abort.signal,
              });
              if (!upstream.ok) {
                if (upstream.status === 401) {
                  saved!.expiresAt = 0;
                  throw new Error("ChatGPT session expired. Reconnect in Settings → AI.");
                }
                send(upstream.status, {
                  error:
                    upstream.status === 429
                      ? "ChatGPT usage limit reached. Manage usage in ChatGPT or try later."
                      : "ChatGPT could not complete this request. Check plan permissions and retry.",
                });
                return;
              }
              if (!upstream.body) throw new Error("ChatGPT returned no response stream.");
              res.setHeader("Content-Type", "text/event-stream");
              const reader = upstream.body.getReader();
              try {
                while (true) {
                  const { value, done } = await reader.read();
                  if (done || abort.signal.aborted) break;
                  if (!res.write(value))
                    await new Promise<void>((done) => {
                      res.once("drain", done);
                      res.once("close", done);
                    });
                }
              } finally {
                await reader.cancel().catch(() => {});
                reader.releaseLock();
              }
              res.end();
            } finally {
              streams.delete(abort);
            }
            return;
          }
          send(404, { error: "Not found" });
        } catch (failure) {
          // Keep diagnostics, request bodies and credentials out of Vite's logger.
          const message =
            failure instanceof Error &&
            /^(Sign-in|ChatGPT|Registration|Invalid|Connect|Choose|No eligible|Request too large|Too many)/.test(
              failure.message,
            )
              ? failure.message
              : "ChatGPT connection failed. Return to Settings → AI and reconnect.";
          error = message;
          if (!res.headersSent) send(400, { error: message });
          else res.end();
        }
      });
    },
  };
}
