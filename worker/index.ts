/**
 * CORS relay to the Anthropic Messages API.
 *
 * The caller supplies their own key on every request. The Worker holds no credential of its
 * own, on purpose: a hosted key behind a public endpoint is a hosted key anyone can spend.
 * An `Origin` header is set by the browser but forged trivially by anything that isn't one,
 * so it can gate CORS and nothing else. With no server-side key there is nothing left for
 * a forged origin to reach.
 */
/**
 * The Vite dev server is here too. That is safe precisely because the Worker holds no
 * credential: this check gates CORS, not access to anything, and every caller still has to
 * supply their own key. Conductor may allocate any free local port, so localhost origins are
 * accepted by hostname rather than pinning the allowlist to whichever port happened to be
 * free on the developer's machine. Without this, the browser reports "Failed to fetch" and
 * the UI shows "Could not reach Anthropic" — a confusing way to say "you are on localhost".
 */
const ALLOWED_ORIGINS = new Set([
  "https://precipice.pages.dev",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin || ALLOWED_ORIGINS.has(origin)) return !!origin;
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}
const MAX_BODY_BYTES = 256 * 1024;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const MAX_TRACKED_IPS = 10_000;

/** Everything else the caller sends is dropped rather than relayed to Anthropic. */
const FORWARDED_HEADERS = ["content-type", "accept", "anthropic-version", "anthropic-beta"];

/**
 * Best-effort abuse damping, not a rate limit. This map lives in one isolate, and Cloudflare
 * runs many and recycles them freely, so the real ceiling is some unknown multiple of this.
 * Its size is capped so a flood of distinct IPs cannot retain unbounded memory in a warm
 * isolate. Treat anything stronger as unimplemented.
 */
const buckets = new Map<string, { started: number; count: number }>();

function cors(origin: string | null): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, anthropic-version, anthropic-beta, x-api-key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });
  if (isAllowedOrigin(origin)) headers.set("Access-Control-Allow-Origin", origin!);
  return headers;
}

function json(data: unknown, status: number, origin: string | null): Response {
  const headers = cors(origin);
  headers.set("Content-Type", "application/json");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status, headers });
}

function withinRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.started >= WINDOW_MS) {
    if (!bucket && buckets.size >= MAX_TRACKED_IPS) {
      for (const [candidate, entry] of buckets) {
        if (now - entry.started >= WINDOW_MS) buckets.delete(candidate);
      }
      // A full map of active buckets is still safer to discard than to let an attacker grow
      // it indefinitely. This only makes the guard less effective under an active flood.
      if (buckets.size >= MAX_TRACKED_IPS) buckets.clear();
    }
    buckets.set(ip, { started: now, count: 1 });
    return true;
  }
  return ++bucket.count <= MAX_REQUESTS_PER_WINDOW;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/messages") {
      return json({ error: "Not found" }, 404, origin);
    }
    if (!isAllowedOrigin(origin)) {
      return json({ error: "Origin not allowed" }, 403, origin);
    }

    const apiKey = request.headers.get("x-api-key")?.trim();
    if (!apiKey) {
      return json({ error: "Add an Anthropic API key in settings." }, 401, origin);
    }

    // Advisory only — a chunked request has no Content-Length. The check after buffering
    // is the one that actually holds.
    const declaredLength = Number(request.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return json({ error: "Request too large" }, 413, origin);
    }

    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (!withinRateLimit(ip)) return json({ error: "Rate limit exceeded" }, 429, origin);

    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) return json({ error: "Request too large" }, 413, origin);

    // Built from an allowlist, never inherited: inheriting relays the caller's cookies,
    // Authorization, and CF-* headers straight to Anthropic.
    const upstreamHeaders = new Headers();
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value) upstreamHeaders.set(name, value);
    }
    upstreamHeaders.set("x-api-key", apiKey);
    upstreamHeaders.set("anthropic-dangerous-direct-browser-access", "true");
    if (!upstreamHeaders.has("anthropic-version")) {
      upstreamHeaders.set("anthropic-version", "2023-06-01");
    }

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: upstreamHeaders,
      body,
    });

    const responseHeaders = cors(origin);
    // Carried through so streamed responses stay `text/event-stream` rather than being sniffed.
    const contentType = upstream.headers.get("Content-Type");
    if (contentType) responseHeaders.set("Content-Type", contentType);
    responseHeaders.set("Cache-Control", "no-store");
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  },
};
