import { z } from "zod";

/**
 * The wire contract between the app and the publication Worker.
 *
 * **Frozen on merge, same rules as `src/core`.** Four agents build against this in parallel;
 * a change here is a change to everyone's ground truth. If you need one, stop, write it into
 * `NOTES.md`, and let it land on `main` so everybody rebases onto the same shape.
 *
 * Two constraints on what may go in this file:
 *
 *   1. **Zod is the only import.** `worker/publish/**` imports this module by relative path
 *      and is bundled by Wrangler, which knows nothing about the `@/` alias. Reaching into
 *      `src/core` from here would drag the editor's type graph into the Worker.
 *   2. **No runtime that assumes a DOM or a Node built-in.** It runs in a browser and on
 *      Workers, so `TextEncoder`, `crypto.subtle` and `JSON` only.
 */

/* -------------------------------------------------------------------------- */
/* Bounds                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every bound in the system, declared here and nowhere else.
 *
 * These are security controls, not product limits. This schema is the Worker's only parser of
 * attacker-controlled data, and a Zod string with no `.max()` is an unbounded-input hole. The
 * object cap matters for the same reason: a 50,000-object publication is a denial of service
 * against whoever opens the link, not merely a large document.
 *
 * Both sides import them, so the client can never offer to publish something the Worker is
 * going to reject.
 */
export const LIMITS = {
  /** Buffered request body ceiling. Enforced on the real bytes, never on `Content-Length`. */
  payloadBytes: 2 * 1024 * 1024,
  objects: 500,
  relationships: 1000,
  title: 200,
  name: 200,
  /** Note bodies and journey step details, post-Markdown. */
  bodyChars: 20_000,
  /** Serialized size of one object's plugin-owned `data`. */
  objectDataBytes: 64 * 1024,
  /** Relationship labels are one word or two, never prose. */
  label: 200,
  /** Object and relationship ids, as minted by `src/core/ids.ts`. */
  id: 128,
  type: 64,
} as const;

/** Active publications per account. */
export const PUBLICATION_LIMIT = 5;

/** `pub_` + 128 bits, base32. Unguessability is the only access control a publication has. */
export const PUBLICATION_ID_PATTERN = /^pub_[0-9a-z]{26}$/;

/* -------------------------------------------------------------------------- */
/* The projection                                                              */
/* -------------------------------------------------------------------------- */

const id = z.string().min(1).max(LIMITS.id);

/**
 * Byte length, not `String.length`. A 20,000-character body of astral-plane emoji is 80 kB,
 * and the limit exists to bound what gets stored and parsed, not what gets displayed.
 */
const encoder = new TextEncoder();

function byteLength(value: unknown): number {
  return encoder.encode(JSON.stringify(value ?? null)).length;
}

/**
 * Plugin-owned data is opaque to the contract — the object plugins own their schemas and the
 * Worker must not need to know about them to accept a publication. It is bounded by size and
 * re-validated per type by the viewer through the plugin's own schema. What the Worker checks
 * is that no single object can be huge.
 */
const objectData = z
  .record(z.string(), z.unknown())
  .refine((data) => byteLength(data) <= LIMITS.objectDataBytes, {
    message: `object data exceeds ${LIMITS.objectDataBytes} bytes`,
  });

export const publishedObjectSchema = z.object({
  id,
  type: z.string().min(1).max(LIMITS.type),
  title: z.string().max(LIMITS.title),
  data: objectData,
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().min(200).max(900).optional(),
});

export const publishedRelationshipSchema = z.object({
  id,
  from: id,
  to: id,
  label: z.string().max(LIMITS.label).optional(),
});

/**
 * What a stranger receives. Deliberately not a `Scape`:
 *
 * no local scape id (it is the key to the author's own library), no action log (it is an edit
 * history, and the model prompts are in it), no `createdAt`/`updatedAt` (they leak working
 * hours), no `meta` (the starter is an authoring detail), and no link back to the publication.
 *
 * Positions travel because layout is meaning here — the viewer does not run Dagre, it renders
 * what the author arranged. Objects are a flat array rather than a record plus an order, since
 * a record with a separate order is two things that can disagree on the wire.
 */
export const publishedScapeSchema = z.object({
  name: z.string().max(LIMITS.name),
  objects: z.array(publishedObjectSchema).max(LIMITS.objects),
  relationships: z.array(publishedRelationshipSchema).max(LIMITS.relationships),
  viewState: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    zoom: z.number().finite().min(0.01).max(10),
  }),
});

export type PublishedObject = z.infer<typeof publishedObjectSchema>;
export type PublishedRelationship = z.infer<typeof publishedRelationshipSchema>;
export type PublishedScape = z.infer<typeof publishedScapeSchema>;

/* -------------------------------------------------------------------------- */
/* Canonical form                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The exact bytes both sides hash.
 *
 * `JSON.stringify` preserves insertion order, so two structurally identical projections built
 * by different code paths stringify differently and would compare as changed. This sorts every
 * object key at every depth, so the output is a function of the value alone.
 *
 * Arrays keep their order: `objects` is the author's ordering and reordering *is* a change.
 *
 * The hash of this string drives idempotency and the "Update available" state. It is not an
 * integrity check — which is why the client never sends one. The Worker computes the hash over
 * what it received and returns it; a hash the client supplied would only ever agree with the
 * payload the same client just built.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] === undefined) continue; // stringify drops these anyway; do it predictably
    out[key] = sortKeys(source[key]);
  }
  return out;
}

/** SHA-256 of the canonical form, hex. Available in browsers and on Workers alike. */
export async function canonicalHash(projection: PublishedScape): Promise<string> {
  const bytes = encoder.encode(canonicalize(projection));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The closed set. The client switches on `error`, never on the HTTP status or the message —
 * the message is for a human reading a log, the code is what the UI branches on.
 */
export const PUBLISH_ERRORS = [
  "quota_exceeded",
  "not_found",
  "unpublished",
  "unauthorized",
  "invalid_projection",
  "too_large",
  "rate_limited",
  "server_error",
] as const;

export type PublishErrorCode = (typeof PUBLISH_ERRORS)[number];

export const publishErrorSchema = z.object({
  error: z.enum(PUBLISH_ERRORS),
  /** Safe to show a user. Never contains anything the Worker would not put in a log. */
  message: z.string().max(500).optional(),
});

export type PublishError = z.infer<typeof publishErrorSchema>;

/** The status a code maps to. One table, so the Worker and the stub cannot disagree. */
export const ERROR_STATUS: Record<PublishErrorCode, number> = {
  unauthorized: 401,
  not_found: 404,
  unpublished: 410,
  quota_exceeded: 409,
  invalid_projection: 422,
  too_large: 413,
  rate_limited: 429,
  server_error: 500,
};

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                   */
/* -------------------------------------------------------------------------- */

export type PublicationStatus = "published" | "unpublished";

/**
 * What every mutating endpoint returns, and what the client stores. `publicationId` survives
 * unpublish so a republish restores the same public URL — an unpublish that burns the link is
 * indistinguishable from a delete to anyone holding it.
 */
export const publicationSchema = z.object({
  publicationId: z.string().regex(PUBLICATION_ID_PATTERN),
  /** Computed by the Worker over what it received. The client stores what it is told. */
  hash: z.string().length(64),
  version: z.number().int().min(1),
  status: z.enum(["published", "unpublished"]),
  url: z.string().max(500),
  updatedAt: z.number().int(),
});

export type Publication = z.infer<typeof publicationSchema>;

/** `POST /publications` and `PUT /publications/:id`. */
export const publishRequestSchema = z.object({
  scape: publishedScapeSchema,
});

export type PublishRequest = z.infer<typeof publishRequestSchema>;

/** `GET /publications` — drives "3 of 5 published" without loading any snapshot. */
export const publicationListSchema = z.object({
  publications: z.array(publicationSchema).max(100),
  limit: z.number().int(),
  /** Count of `status: "published"`, which is what the quota actually counts. */
  used: z.number().int(),
});

export type PublicationList = z.infer<typeof publicationListSchema>;

/**
 * `GET /p/:id` — the pointer read. Unauthenticated, `no-store`, and deliberately tiny so it
 * stays cheap: the snapshot itself is served from an immutable versioned URL that the edge
 * can cache for a year. Unpublish still takes effect instantly, because this gates it.
 */
export const publicationPointerSchema = z.object({
  publicationId: z.string().regex(PUBLICATION_ID_PATTERN),
  version: z.number().int().min(1),
  hash: z.string().length(64),
  /** Where to fetch the snapshot. Relative to the API origin. */
  snapshotPath: z.string().max(500),
  updatedAt: z.number().int(),
});

export type PublicationPointer = z.infer<typeof publicationPointerSchema>;

/** `POST /auth/exchange` — the one-time fragment code for a session token. */
export const sessionSchema = z.object({
  token: z.string().min(20).max(500),
  /** Epoch ms. The client refuses to send an expired token rather than learning from a 401. */
  expiresAt: z.number().int(),
  email: z.string().max(320),
  name: z.string().max(200).optional(),
});

export type Session = z.infer<typeof sessionSchema>;

/* -------------------------------------------------------------------------- */
/* Paths                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Public routes live under `/p/` and `/embed/`, never `/s/`. The local editor is already
 * `/#/s/<localScapeId>` — same prefix and a different id space, told apart only by a `#`, is
 * a support burden and a security smell at the same time.
 */
export const publicPath = (publicationId: string) => `/p/${publicationId}`;
export const embedPath = (publicationId: string) => `/embed/${publicationId}`;
