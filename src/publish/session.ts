import { sessionSchema, type Session } from "./contract";
import { exchange, startAuth } from "./client";

/**
 * The publication session: storage, the sign-in redirect, and the return leg.
 *
 * **Why this token lives in `localStorage` when the Anthropic key does not.** They are
 * different risk classes. The Anthropic key is a bearer credential to a third party's paid API,
 * with no scope and no revocation — it lives in `sessionStorage` so it cannot outlive the tab
 * (`src/app/useAppSettings.ts`). This token is scoped to publications, revocable from the
 * server, and expires in seven days. Making someone sign in with Google on every tab would be a
 * real cost for no security gain.
 */
const SESSION_KEY = "precipice.publishSession";

/**
 * The scape a user asked to publish before being sent to Google. A module-level variable does
 * not survive a top-level navigation, which is why `src/app/pending.ts` is reused as an idea
 * rather than as a module.
 */
const PENDING_KEY = "precipice.pendingPublish";

export function readSession(): Session | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SESSION_KEY);
  } catch {
    return null; // Private mode, or storage disabled. Not an error worth surfacing.
  }
  if (!raw) return null;

  const parsed = sessionSchema.safeParse(safeJson(raw));
  // An expired token is discarded here rather than being sent and learning from a 401 — the
  // round trip tells the user nothing and the server nothing it wants to know.
  if (!parsed.success || parsed.data.expiresAt <= Date.now()) {
    clearSession();
    return null;
  }
  return parsed.data;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeSession(session: Session): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* Nothing useful to do; the user simply signs in again next time. */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function setPendingPublish(scapeId: string): void {
  try {
    sessionStorage.setItem(PENDING_KEY, scapeId);
  } catch {
    /* ignore */
  }
}

/** Reads and clears in one step: an intent must never be able to fire twice. */
export function takePendingPublish(): string | null {
  try {
    const value = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    return value;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* The redirect                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Send the user to Google.
 *
 * A top-level redirect, not a popup. `public/_headers` sets
 * `Cross-Origin-Opener-Policy: same-origin`, and a popup that navigates cross-origin under that
 * policy is severed from its opener permanently — `window.opener` is null even once it comes
 * back same-origin. A popup flow would therefore require weakening COOP for the origin that
 * holds every one of the user's scapes.
 *
 * `returnRoute` is the app's *hash* route (`/s/<id>`), not a real path. The Worker validates it
 * as a path, keeps it server-side bound to the `state`, and hands it back in the fragment.
 */
export async function startSignIn(returnRoute: string, turnstileToken: string): Promise<void> {
  const authorizationUrl = await startAuth(returnRoute, turnstileToken);
  window.location.assign(authorizationUrl);
}

export interface AuthReturn {
  /** The hash route to restore, e.g. `/s/scp_abc`. */
  returnRoute: string;
  session: Session;
}

/**
 * The other half of the redirect.
 *
 * The Worker sends the browser to `<app>/#token=<code>&return=<route>` — **one** fragment
 * carrying both values, because this app's routes live in the fragment. Putting the route in
 * the path instead would 404 on Pages, and putting the token in the query would write a
 * credential into access logs and the `Referer`.
 *
 * The code is single-use with a 60-second TTL, but a fragment is readable by any script on the
 * page and sits in the address bar, so it is exchanged immediately and erased with
 * `replaceState` before anything else runs.
 */
export function readAuthFragment(hash: string): { code: string; returnRoute: string } | null {
  const raw = hash.replace(/^#/, "");
  if (!raw.startsWith("token=")) return null;

  const params = new URLSearchParams(raw);
  const code = params.get("token");
  if (!code || !/^[A-Za-z0-9_-]{20,500}$/.test(code)) return null;

  return { code, returnRoute: safeRoute(params.get("return")) };
}

export type AuthErrorCode = "invite_required" | "server_error";

export interface AuthErrorReturn {
  code: AuthErrorCode;
  returnRoute: string;
}

/**
 * The Worker sends an OAuth rejection back to the app in the same fragment channel as a
 * successful sign-in. Keeping this parser strict means an arbitrary hash can never turn into an
 * app-level error or an unsafe navigation.
 */
export function readAuthErrorFragment(hash: string): AuthErrorReturn | null {
  const raw = hash.replace(/^#/, "");
  if (!raw.startsWith("auth_error=")) return null;

  const params = new URLSearchParams(raw);
  const code = params.get("auth_error");
  if (code !== "invite_required" && code !== "server_error") return null;

  return { code, returnRoute: safeRoute(params.get("return")) };
}

/**
 * The same path-only rule the Worker applies to `return`. The Worker is the defence that
 * matters — it is what stops an open redirect becoming token theft — but this value is about
 * to be written into `location.hash`, so it is checked again on arrival.
 */
export function safeRoute(value: string | null): string {
  if (!value) return "/";
  if (value.length > 200) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  // Mirrors `safeReturn` in the Worker, which is the defence that matters; kept in step with
  // it. No scheme, no backslash, no whitespace, no control characters, and no `?`/`#`/`@` —
  // this is a path, and `@` in particular turns `host/path` into userinfo for a different host
  // in a lax parser. Hyphens and underscores are allowed: `slugId` generates them.
  if (/[:\\?#@]/.test(value) || /\s/.test(value) || /[\u0000-\u001f\u007f]/.test(value)) {
    return "/";
  }
  return value;
}

/**
 * Runs once at boot. Exchanges the code if there is one, stores the session, strips the
 * fragment, and returns where the user was going.
 */
export async function completeSignIn(
  location: { hash: string } = window.location,
): Promise<AuthReturn | null> {
  const fragment = readAuthFragment(location.hash);
  if (!fragment) return null;

  try {
    const session = await exchange(fragment.code);
    writeSession(session);
    return { returnRoute: fragment.returnRoute, session };
  } finally {
    // Erased whether or not the exchange worked: a spent or rejected code left in the address
    // bar is a value that gets pasted into a bug report.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}
