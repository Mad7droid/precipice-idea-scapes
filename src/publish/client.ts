import {
  adminListSchema,
  authStartSchema,
  publicationListSchema,
  publicationSchema,
  publishErrorSchema,
  sessionSchema,
  type Publication,
  type PublicationList,
  type AdminList,
  type PublishErrorCode,
  type PublishedScape,
  type Session,
} from "./contract";

/**
 * Every call to the publication Worker, typed against the contract both sides import.
 *
 * The token goes in an `Authorization: Bearer` header and never in a cookie. `precipice.pages.dev`
 * and `*.workers.dev` are separate registrable domains, both on the Public Suffix List, so a
 * cookie between them is a third-party cookie — Safari's ITP and Firefox's TCP drop it, and
 * publishing would fail on two engines out of three with a 401 the user cannot act on. Cookies
 * are also the only reason CSRF tokens and credentialed CORS would appear here at all.
 */
export const API_ORIGIN = (import.meta.env.VITE_PUBLICATION_API_URL ?? "").replace(/\/+$/, "");

/** A failure the UI can branch on — `quota_exceeded` in particular has its own affordance. */
export class PublishClientError extends Error {
  constructor(
    readonly code: PublishErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PublishClientError";
  }
}

/** Copy for each way this can fail. Sentence case, active voice, says what to do next. */
const MESSAGES: Record<PublishErrorCode, string> = {
  quota_exceeded: "You have used all 50 retained publication slots. Delete one to free a slot.",
  not_found: "That publication no longer exists on the server.",
  unpublished: "That publication is not currently published.",
  unauthorized: "Your sign-in has expired. Sign in again to publish.",
  invalid_projection: "This scape could not be published. Some blocks may be unsupported.",
  too_large: "This scape is too large to publish.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  invite_required: "Publishing is currently invite-only. Ask an administrator for an invitation.",
  account_suspended: "This publishing account is suspended. Contact an administrator for help.",
  bot_check_failed: "Complete the security check and try again.",
  daily_write_limit: "You have reached today’s publishing write limit. Try again tomorrow.",
  storage_limit: "This account has reached its publication storage limit. Delete a publication and try again.",
  admin_required: "Only publishing administrators can do that.",
  server_error: "The server could not complete that. Try again shortly.",
};

export interface RequestOptions {
  token?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

async function call(
  method: string,
  path: string,
  { token, fetchImpl = fetch, signal }: RequestOptions,
  body?: unknown,
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetchImpl(`${API_ORIGIN}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    if ((cause as { name?: string })?.name === "AbortError") throw cause;
    throw new PublishClientError("server_error", "Could not reach the publishing service.");
  }

  if (response.status === 204) return null;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = publishErrorSchema.safeParse(payload);
    const code: PublishErrorCode = parsed.success ? parsed.data.error : "server_error";
    // The server's own message is preferred when it sent one — it is written to be shown, and
    // it can be more specific than the table above.
    throw new PublishClientError(code, parsed.data?.message || MESSAGES[code]);
  }

  return payload;
}

function parse<T>(schema: { safeParse: (value: unknown) => { success: boolean; data?: T } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success || result.data === undefined) {
    throw new PublishClientError("server_error", "The server sent a response we could not read.");
  }
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

/** Trades the one-time code from the return fragment for a session token. */
export async function exchange(code: string, options: RequestOptions = {}): Promise<Session> {
  return parse(sessionSchema, await call("POST", "/auth/exchange", options, { token: code }));
}

/** Starts OAuth only after the editor has obtained a fresh Turnstile token. */
export async function startAuth(
  returnRoute: string,
  turnstileToken: string,
  options: RequestOptions = {},
): Promise<string> {
  const result = parse(
    authStartSchema,
    await call("POST", "/auth/start", options, { return: returnRoute, turnstileToken }),
  );
  return result.authorizationUrl;
}

export async function logout(options: RequestOptions): Promise<void> {
  await call("POST", "/auth/logout", options);
}

export async function deleteAccount(options: RequestOptions): Promise<void> {
  await call("DELETE", "/account", options);
}

/* -------------------------------------------------------------------------- */
/* Publications                                                                */
/* -------------------------------------------------------------------------- */

export async function listPublications(options: RequestOptions): Promise<PublicationList> {
  return parse(publicationListSchema, await call("GET", "/publications", options));
}

export async function createPublication(
  scape: PublishedScape,
  options: RequestOptions,
): Promise<Publication> {
  return parse(publicationSchema, await call("POST", "/publications", options, { scape }));
}

export async function updatePublication(
  publicationId: string,
  scape: PublishedScape,
  options: RequestOptions,
): Promise<Publication> {
  return parse(
    publicationSchema,
    await call("PUT", `/publications/${publicationId}`, options, { scape }),
  );
}

export async function unpublish(
  publicationId: string,
  options: RequestOptions,
): Promise<Publication> {
  return parse(
    publicationSchema,
    await call("POST", `/publications/${publicationId}/unpublish`, options),
  );
}

export async function republish(
  publicationId: string,
  options: RequestOptions,
): Promise<Publication> {
  return parse(
    publicationSchema,
    await call("POST", `/publications/${publicationId}/republish`, options),
  );
}

export async function deletePublication(
  publicationId: string,
  options: RequestOptions,
): Promise<void> {
  await call("DELETE", `/publications/${publicationId}`, options);
}

/* -------------------------------------------------------------------------- */
/* Administration                                                             */
/* -------------------------------------------------------------------------- */

export async function listAdmin(options: RequestOptions, cursor?: number): Promise<AdminList> {
  return parse(adminListSchema, await call("GET", `/admin${cursor ? `?cursor=${cursor}` : ""}`, options));
}

export async function createInvite(email: string, options: RequestOptions): Promise<void> {
  await call("POST", "/admin/invites", options, { email });
}

export async function revokeInvite(email: string, options: RequestOptions): Promise<void> {
  await call("DELETE", `/admin/invites/${encodeURIComponent(email)}`, options);
}

export async function setMemberStatus(
  id: string,
  status: "active" | "suspended",
  options: RequestOptions,
): Promise<void> {
  await call("POST", `/admin/members/${encodeURIComponent(id)}/${status === "active" ? "restore" : "suspend"}`, options);
}
