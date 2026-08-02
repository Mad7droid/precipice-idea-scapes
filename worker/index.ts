const ALLOWED_ORIGINS = new Set(["https://precipice.pages.dev"]);
const MAX_BODY_BYTES = 256 * 1024;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;

interface Env { ANTHROPIC_API_KEY: string }
const buckets = new Map<string, { started: number; count: number }>();

function cors(origin: string | null): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, anthropic-version, x-api-key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });
  if (origin && ALLOWED_ORIGINS.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function json(data: unknown, status: number, origin: string | null): Response {
  const headers = cors(origin);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const headers = cors(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/messages") {
      return json({ error: "Not found" }, 404, origin);
    }
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed" }, 403, origin);
    const requestApiKey = request.headers.get("x-api-key")?.trim();
    const apiKey = requestApiKey || env.ANTHROPIC_API_KEY;
    if (!apiKey) return json({ error: "Worker is not configured" }, 500, origin);
    const contentLength = Number(request.headers.get("Content-Length") ?? 0);
    if (contentLength > MAX_BODY_BYTES) return json({ error: "Request too large" }, 413, origin);
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const now = Date.now();
    const bucket = buckets.get(ip);
    if (!bucket || now - bucket.started >= WINDOW_MS) buckets.set(ip, { started: now, count: 1 });
    else if (++bucket.count > MAX_REQUESTS_PER_WINDOW) return json({ error: "Rate limit exceeded" }, 429, origin);
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) return json({ error: "Request too large" }, 413, origin);
    const upstreamHeaders = new Headers(request.headers);
    upstreamHeaders.set("x-api-key", apiKey);
    upstreamHeaders.set("anthropic-dangerous-direct-browser-access", "true");
    upstreamHeaders.delete("origin");
    upstreamHeaders.delete("referer");
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: upstreamHeaders, body,
    });
    const responseHeaders = cors(origin);
    responseHeaders.set("Cache-Control", "no-store");
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  },
};
