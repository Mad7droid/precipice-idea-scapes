import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * A D1 and R2 stand-in for testing the publication Worker in-process.
 *
 * D1 is backed by real SQLite running the real migrations, so the Worker's
 * SQL executes unmodified. That matters more than it sounds: the quota is enforced by a
 * conditional `INSERT ... SELECT ... WHERE (SELECT COUNT(*)) < ?`, and owner isolation by
 * `AND owner_id = ?` in the `WHERE` clause of each mutation. Both are properties of the SQL
 * itself — a hand-written fake that pattern-matched queries would assert that the test author
 * understood the rules, not that the Worker implements them.
 *
 * R2 is a Map, because nothing security-relevant depends on its behaviour.
 */
export interface D1Result<T = unknown> {
  results: T[];
  meta: { changes: number };
}

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): Statement {
    return new Statement(this.db, this.sql, params);
  }

  async first<T = unknown>(): Promise<T | null> {
    // `RETURNING` makes a DELETE or UPDATE a reader, and node:sqlite refuses `.get()` on a
    // statement it considers a writer — so route by whether the SQL actually returns rows.
    const statement = this.db.prepare(this.sql);
    const row = /returning/i.test(this.sql)
      ? (statement.all(...(this.params as never[]))[0] ?? null)
      : (statement.get(...(this.params as never[])) ?? null);
    return (row as T) ?? null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const rows = this.db.prepare(this.sql).all(...(this.params as never[]));
    return { results: rows as T[], meta: { changes: 0 } };
  }

  async run(): Promise<D1Result> {
    if (/returning/i.test(this.sql)) {
      const rows = this.db.prepare(this.sql).all(...(this.params as never[]));
      return { results: rows as unknown[], meta: { changes: rows.length } };
    }
    const info = this.db.prepare(this.sql).run(...(this.params as never[]));
    return { results: [], meta: { changes: Number(info.changes) } };
  }
}

export class TestD1 {
  readonly db = new DatabaseSync(":memory:");

  constructor() {
    for (const migration of ["0001_initial.sql", "0002_security.sql", "0003_session_ttl.sql"]) {
      this.db.exec(readFileSync(resolve(__dirname, "migrations", migration), "utf8"));
    }
  }

  prepare(sql: string): Statement {
    return new Statement(this.db, sql);
  }

  async batch(statements: Array<Promise<D1Result> | Statement>): Promise<D1Result[]> {
    const out: D1Result[] = [];
    for (const statement of statements) {
      out.push(statement instanceof Statement ? await statement.run() : await statement);
    }
    return out;
  }

  /** Direct access, for asserting on state the Worker's API does not expose. */
  count(table: string, where = "1=1", params: unknown[] = []): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`)
      .get(...(params as never[])) as { c: number };
    return Number(row.c);
  }
}

export class TestR2 {
  readonly objects = new Map<string, string>();

  async put(key: string, value: string): Promise<void> {
    this.objects.set(key, value);
  }

  async get(key: string): Promise<{ body: ReadableStream; text(): Promise<string> } | null> {
    const value = this.objects.get(key);
    if (value === undefined) return null;
    // The Worker streams `object.body` straight into the response rather than buffering it,
    // so the shim has to offer one — returning only `text()` yields an empty 200.
    return { body: new Response(value).body!, text: async () => value };
  }

  async head(key: string): Promise<{ size: number } | null> {
    const value = this.objects.get(key);
    return value === undefined ? null : { size: new TextEncoder().encode(value).byteLength };
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }

  async list({ prefix }: { prefix: string }): Promise<{ objects: Array<{ key: string }> }> {
    return {
      objects: [...this.objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ key })),
    };
  }
}

export interface Harness {
  env: Record<string, unknown>;
  db: TestD1;
  r2: TestR2;
  /** Flips to false to exercise the 429 path. */
  allowRequests: { value: boolean };
}

export const APP_ORIGIN = "https://precipice.pages.dev";

export function harness(): Harness {
  const db = new TestD1();
  const r2 = new TestR2();
  const allowRequests = { value: true };

  return {
    db,
    r2,
    allowRequests,
    env: {
      APP_ORIGIN,
      GOOGLE_CLIENT_ID: "123456789012-testclient.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "test-secret",
      PUBLISH_DB: db,
      PUBLICATIONS: r2,
      AUTH_LIMIT: { limit: async () => ({ success: allowRequests.value }) },
      PUBLIC_READ_LIMIT: { limit: async () => ({ success: allowRequests.value }) },
      MUTATION_IP_LIMIT: { limit: async () => ({ success: allowRequests.value }) },
      MUTATION_USER_LIMIT: { limit: async () => ({ success: allowRequests.value }) },
      __verifyTurnstile: async (token: string) => token === "valid-turnstile-token" ? { success: true, hostname: new URL(APP_ORIGIN).hostname, action: "publish-auth" } : { success: false },
    },
  };
}

/** Creates a user and a live session directly, skipping the Google leg. */
export async function seedSession(
  db: TestD1,
  { userId = "usr_test", email = "you@example.com", token = "token-".padEnd(40, "x") } = {},
): Promise<{ userId: string; token: string }> {
  const now = Date.now();
  db.db
    .prepare(
      "INSERT OR IGNORE INTO users (id, google_sub, email, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(userId, `sub-${userId}`, email, null, now, now);
  db.db
    .prepare(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(`ses_${userId}`, userId, await sha256(token), now + 86_400_000, now);
  return { userId, token };
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A request shaped the way a browser would send it: `Origin` set, bearer token supplied. */
export function request(
  method: string,
  path: string,
  { token, body, origin = APP_ORIGIN }: { token?: string; body?: unknown; origin?: string | null } = {},
): Request {
  const headers: Record<string, string> = {};
  if (origin) headers.Origin = origin;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return new Request(`https://publish.example${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
