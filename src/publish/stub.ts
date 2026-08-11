import {
  ERROR_STATUS,
  PUBLICATION_LIMIT,
  canonicalize,
  publicationSchema,
  publishRequestSchema,
  type Publication,
  type PublishErrorCode,
} from "./contract";

/**
 * An in-memory publication Worker, implementing `contract.ts`.
 *
 * This is what `/dev/publish` runs against, and what the client's tests run against. It exists
 * so the entire lifecycle — including the quota 409, which is the hardest state to reach on a
 * real server — can be driven without a Worker, a D1 database, or a Google account.
 *
 * It is deliberately *not* a mock with canned responses: it holds state and enforces the same
 * rules, so a client bug shows up here rather than in production. What it does not do is
 * security. Ownership, rate limits and hostile input are the Worker's, and the Worker has its
 * own tests for them.
 */
export interface StubOptions {
  /** Start signed out to exercise the sign-in path. */
  token?: string | null;
  now?: () => number;
}

interface Row {
  publicationId: string;
  status: "published" | "unpublished" | "deleted";
  version: number;
  hash: string;
  updatedAt: number;
  snapshots: Map<number, string>;
}

const APP_ORIGIN = "https://precipice.pages.dev";

export class PublishStub {
  private rows = new Map<string, Row>();
  private counter = 0;
  private now: () => number;

  token: string | null;

  constructor({ token = "stub-token-000000000000", now = Date.now }: StubOptions = {}) {
    this.token = token;
    this.now = now;
  }

  /** Drop-in for `fetch`, passed to the client as `fetchImpl`. */
  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input.toString(), APP_ORIGIN);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;

    if (url.pathname === "/auth/exchange" && method === "POST") {
      const token = `stub-session-${++this.counter}`.padEnd(24, "0");
      this.token = token;
      return json({
        token,
        expiresAt: this.now() + 30 * 24 * 60 * 60 * 1000,
        email: "you@example.com",
        name: "Test user",
      });
    }

    const bearer = headers.get("Authorization")?.replace(/^Bearer /, "") ?? null;
    if (!this.token || bearer !== this.token) return fail("unauthorized");

    if (url.pathname === "/auth/logout" && method === "POST") {
      this.token = null;
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/publications" && method === "GET") {
      const live = this.live();
      return json({
        publications: live.map((row) => this.publication(row)),
        limit: PUBLICATION_LIMIT,
        used: live.length,
        activeUsed: live.filter((row) => row.status === "published").length,
        storedBytes: live.reduce((sum, row) => sum + new TextEncoder().encode(row.snapshots.get(row.version) ?? "").byteLength, 0),
      });
    }

    if (url.pathname === "/publications" && method === "POST") {
      const parsed = publishRequestSchema.safeParse(body);
      if (!parsed.success) return fail("invalid_projection");
      if (this.live().length >= PUBLICATION_LIMIT) return fail("quota_exceeded");

      const id = `pub_${String(++this.counter).padStart(26, "0").slice(0, 26)}`;
      const hash = await hashOf(canonicalize(parsed.data.scape));
      const row: Row = {
        publicationId: id,
        status: "published",
        version: 1,
        hash,
        updatedAt: this.now(),
        snapshots: new Map([[1, JSON.stringify(parsed.data.scape)]]),
      };
      this.rows.set(id, row);
      return json(this.publication(row), 201);
    }

    const match = url.pathname.match(/^\/publications\/([^/]+)(?:\/(unpublish|republish))?$/);
    if (!match) return fail("not_found");
    const [, id, action] = match;
    const row = this.rows.get(id);
    if (!row || row.status === "deleted") return fail("not_found");

    if (method === "PUT" && !action) {
      const parsed = publishRequestSchema.safeParse(body);
      if (!parsed.success) return fail("invalid_projection");
      if (row.status !== "published") return fail("unpublished");
      row.version += 1;
      row.hash = await hashOf(canonicalize(parsed.data.scape));
      row.updatedAt = this.now();
      row.snapshots.set(row.version, JSON.stringify(parsed.data.scape));
      return json(this.publication(row));
    }

    if (method === "POST" && action === "unpublish") {
      if (row.status !== "published") return fail("unpublished");
      row.status = "unpublished";
      row.updatedAt = this.now();
      return json(this.publication(row));
    }

    if (method === "POST" && action === "republish") {
      if (row.status !== "unpublished") return fail("invalid_projection");
      row.status = "published";
      row.updatedAt = this.now();
      return json(this.publication(row));
    }

    if (method === "DELETE" && !action) {
      row.status = "deleted";
      row.snapshots.clear();
      return new Response(null, { status: 204 });
    }

    return fail("not_found");
  };

  /** The public read, for driving the viewer against the same state. */
  snapshot(publicationId: string, version: number): string | undefined {
    return this.rows.get(publicationId)?.snapshots.get(version);
  }

  private live(): Row[] {
    return [...this.rows.values()].filter((row) => row.status !== "deleted");
  }

  private publication(row: Row): Publication {
    return publicationSchema.parse({
      publicationId: row.publicationId,
      hash: row.hash,
      version: row.version,
      status: row.status === "deleted" ? "unpublished" : row.status,
      url: `${APP_ORIGIN}/p/${row.publicationId}`,
      updatedAt: row.updatedAt,
    });
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fail(code: PublishErrorCode): Response {
  return json({ error: code }, ERROR_STATUS[code]);
}

async function hashOf(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
