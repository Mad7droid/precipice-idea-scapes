import { beforeEach, describe, expect, it } from "vitest";
import { fixtureScape } from "../../src/core/fixtures";
import { PUBLICATION_LIMIT, canonicalHash } from "../../src/publish/contract";
import { projectScape } from "../../src/publish/project";
import worker, { safeReturn } from "./index";
import { APP_ORIGIN, harness, request, seedSession, sha256, type Harness } from "./harness";

/**
 * The publication Worker.
 *
 * D1 is real SQLite running the real migration, so the quota's conditional INSERT and every
 * `AND owner_id = ?` are exercised as written rather than as understood. The Google leg is the
 * one thing not covered here — it needs a signing key and a JWKS endpoint — so `/auth/start`
 * and `safeReturn` are tested directly and `/auth/callback` is left to manual verification
 * against a real Google client, noted in the runbook.
 */
const ctx = { waitUntil: () => undefined };

let h: Harness;
const fetch = (req: Request) => worker.fetch(req, h.env as never, ctx as never);
const scape = () => projectScape(fixtureScape()).scape;

beforeEach(() => {
  h = harness();
});

/* -------------------------------------------------------------------------- */
/* The open-redirect defence                                                   */
/* -------------------------------------------------------------------------- */

describe("safeReturn", () => {
  /**
   * The highest-severity item in this file.
   *
   * `return` is reflected into the post-sign-in redirect. If it can name an origin, an attacker
   * sends a victim through a genuine Google consent screen and receives the one-time exchange
   * code on their own site — an open redirect here is account takeover, not a nuisance.
   */
  it("falls back to the root for every hostile value", () => {
    for (const hostile of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "http:/evil.example",
      "/path?x=1#@evil.example",
      "javascript:alert(1)",
      "/path\r\nX-Injected: 1",
      `/path${String.fromCharCode(0)}`,
      `/${"x".repeat(300)}`,
      "",
      null,
    ]) {
      expect(safeReturn(hostile as string | null), String(hostile)).toBe("/");
    }
  });

  it("passes through the routes the app actually uses", () => {
    expect(safeReturn("/")).toBe("/");
    expect(safeReturn("/s/scp_abc123")).toBe("/s/scp_abc123");
  });
});

describe("POST /auth/start", () => {
  const start = (body: unknown, origin = APP_ORIGIN) =>
    fetch(request("POST", "/auth/start", { body, origin }));

  it("fails closed until both Google OAuth secrets are configured", async () => {
    delete h.env.GOOGLE_CLIENT_ID;
    const response = await start({ return: "/s/scp_a", turnstileToken: "valid-turnstile-token" });

    expect(response.status).toBe(500);
    expect(response.headers.get("Location")).toBeNull();
    expect(h.db.count("oauth_states")).toBe(0);
  });

  it("fails closed when a Google client secret is entered as the client ID", async () => {
    h.env.GOOGLE_CLIENT_ID = "GOCSPX-not-a-client-id";
    const response = await start({ return: "/s/scp_a", turnstileToken: "valid-turnstile-token" });

    expect(response.status).toBe(500);
    expect(response.headers.get("Location")).toBeNull();
    expect(h.db.count("oauth_states")).toBe(0);
  });

  it("returns a Google URL with PKCE only after a valid Turnstile check", async () => {
    const rejected = await start({ return: "/s/scp_a", turnstileToken: "invalid" });
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toMatchObject({ error: "bot_check_failed" });
    expect(h.db.count("oauth_states")).toBe(0);

    h.env.__verifyTurnstile = async () => ({ success: true, hostname: "evil.example", action: "publish-auth" });
    const wrongHost = await start({ return: "/s/scp_a", turnstileToken: "valid-turnstile-token" });
    expect(wrongHost.status).toBe(403);
    expect(h.db.count("oauth_states")).toBe(0);
    h.env.__verifyTurnstile = async (token: string) => token === "valid-turnstile-token" ? { success: true, hostname: new URL(APP_ORIGIN).hostname, action: "publish-auth" } : { success: false };

    const response = await start({ return: "/s/scp_a", turnstileToken: "valid-turnstile-token" });
    expect(response.status).toBe(200);

    const location = new URL((await response.json() as { authorizationUrl: string }).authorizationUrl);
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toBeTruthy();
    expect(location.searchParams.get("response_type")).toBe("code");

    // The state is stored server-side, bound to the validated return path.
    const state = location.searchParams.get("state")!;
    const row = h.db.db
      .prepare("SELECT return_path, expires_at FROM oauth_states WHERE state = ?")
      .get(state) as { return_path: string; expires_at: number };
    expect(row.return_path).toBe("/s/scp_a");
    expect(row.expires_at).toBeGreaterThan(Date.now());
  });

  it("stores a hostile return value as the root, not as given", async () => {
    const response = await start({ return: "https://evil.example", turnstileToken: "valid-turnstile-token" });
    const state = new URL((await response.json() as { authorizationUrl: string }).authorizationUrl).searchParams.get("state")!;
    const row = h.db.db
      .prepare("SELECT return_path FROM oauth_states WHERE state = ?")
      .get(state) as { return_path: string };
    expect(row.return_path).toBe("/");
  });

  it("requires the exact editor Origin", async () => {
    const response = await start({ turnstileToken: "valid-turnstile-token" }, "https://evil.example");
    expect(response.status).toBe(401);
    expect(h.db.count("oauth_states")).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

describe("sessions", () => {
  it("stores only a hash, so a database disclosure yields no usable session", async () => {
    const { token } = await seedSession(h.db);
    const stored = h.db.db.prepare("SELECT token_hash FROM sessions").get() as {
      token_hash: string;
    };
    expect(stored.token_hash).toBe(await sha256(token));
    expect(stored.token_hash).not.toBe(token);
  });

  it("rejects an unknown token", async () => {
    await seedSession(h.db);
    const response = await fetch(request("GET", "/publications", { token: "not-a-real-token-xx" }));
    expect(response.status).toBe(401);
  });

  it("rejects a request with no token at all", async () => {
    expect((await fetch(request("GET", "/publications"))).status).toBe(401);
  });

  it("rejects an expired session", async () => {
    const { token } = await seedSession(h.db);
    h.db.db.prepare("UPDATE sessions SET expires_at = ?").run(Date.now() - 1000);
    expect((await fetch(request("GET", "/publications", { token }))).status).toBe(401);
  });

  it("revokes every session on logout", async () => {
    const { token } = await seedSession(h.db);
    expect((await fetch(request("POST", "/auth/logout", { token }))).status).toBe(204);
    expect(h.db.count("sessions")).toBe(0);
    expect((await fetch(request("GET", "/publications", { token }))).status).toBe(401);
  });

  it("rejects an exchange code that does not exist", async () => {
    const response = await fetch(
      request("POST", "/auth/exchange", { body: { token: "x".repeat(30) } }),
    );
    expect(response.status).toBe(401);
  });

  it("rejects an expired exchange code", async () => {
    const { userId } = await seedSession(h.db);
    h.db.db
      .prepare("INSERT INTO exchange_codes (code, session_id, expires_at) VALUES (?, ?, ?)")
      .run("y".repeat(30), `ses_${userId}`, Date.now() - 1);
    const response = await fetch(
      request("POST", "/auth/exchange", { body: { token: "y".repeat(30) } }),
    );
    expect(response.status).toBe(401);
  });

  it("spends an exchange code exactly once", async () => {
    const { userId } = await seedSession(h.db);
    const code = "z".repeat(30);
    h.db.db
      .prepare("INSERT INTO exchange_codes (code, session_id, expires_at) VALUES (?, ?, ?)")
      .run(code, `ses_${userId}`, Date.now() + 60_000);

    const first = await fetch(request("POST", "/auth/exchange", { body: { token: code } }));
    expect(first.status).toBe(200);
    const session = (await first.json()) as { token: string };
    expect(session.token.length).toBeGreaterThanOrEqual(20);

    const second = await fetch(request("POST", "/auth/exchange", { body: { token: code } }));
    expect(second.status).toBe(401);
  });

  it("rotates the stored hash on exchange, so the pre-exchange seed is dead", async () => {
    const { userId, token } = await seedSession(h.db);
    const code = "w".repeat(30);
    h.db.db
      .prepare("INSERT INTO exchange_codes (code, session_id, expires_at) VALUES (?, ?, ?)")
      .run(code, `ses_${userId}`, Date.now() + 60_000);

    await fetch(request("POST", "/auth/exchange", { body: { token: code } }));
    expect((await fetch(request("GET", "/publications", { token }))).status).toBe(401);
  });
});

/* -------------------------------------------------------------------------- */
/* Publishing                                                                  */
/* -------------------------------------------------------------------------- */

describe("publishing", () => {
  let token: string;

  beforeEach(async () => {
    ({ token } = await seedSession(h.db));
  });

  const publish = (body = { scape: scape() }) =>
    fetch(request("POST", "/publications", { token, body }));

  it("creates a publication and returns the hash it computed", async () => {
    const response = await publish();
    expect(response.status).toBe(201);

    const publication = (await response.json()) as {
      publicationId: string;
      hash: string;
      version: number;
      status: string;
      url: string;
    };
    expect(publication.status).toBe("published");
    expect(publication.version).toBe(1);
    expect(publication.publicationId).toMatch(/^pub_[0-9a-z]{26}$/);
    expect(publication.url).toBe(`${APP_ORIGIN}/p/${publication.publicationId}`);
    // The Worker hashes what it received; the client never sends a hash.
    expect(publication.hash).toBe(await canonicalHash(scape()));
    expect(h.r2.objects.has(`publications/${publication.publicationId}/v1/scape.json`)).toBe(true);
  });

  it("refuses a fifty-first retained slot", async () => {
    const now = Date.now();
    for (let i = 0; i < PUBLICATION_LIMIT; i++) {
      h.db.db.prepare("INSERT INTO publications (publication_id, owner_id, status, version, hash, current_bytes, updated_at, created_at) VALUES (?, 'usr_test', 'unpublished', 1, ?, 1, ?, ?)").run(`pub_${i.toString(32).padStart(26, "0")}`, "a".repeat(64), now, now);
    }

    const response = await publish();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "quota_exceeded" });
    expect(h.db.count("publications", "status != 'deleted'")).toBe(PUBLICATION_LIMIT);
  });

  it("updates in place without consuming a slot", async () => {
    const created = (await publish().then((r) => r.json())) as { publicationId: string };

    const edited = fixtureScape();
    edited.objects.brief.title = "Revised";
    const response = await fetch(
      request("PUT", `/publications/${created.publicationId}`, {
        token,
        body: { scape: projectScape(edited).scape },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ version: 2, status: "published" });
    expect(h.db.count("publications", "status = 'published'")).toBe(1);
    // The old version is queued for the cron sweeper rather than deleted inline.
    expect(h.db.count("superseded_versions")).toBe(1);
  });

  it("retains a slot on unpublish and keeps the id for republish", async () => {
    const created = (await publish().then((r) => r.json())) as { publicationId: string };
    const id = created.publicationId;

    const withdrawn = await fetch(request("POST", `/publications/${id}/unpublish`, { token }));
    expect(withdrawn.status).toBe(200);
    expect(h.db.count("publications", "status = 'published'")).toBe(0);
    expect(h.db.count("publications", "status != 'deleted'")).toBe(1);

    const restored = await fetch(request("POST", `/publications/${id}/republish`, { token }));
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ publicationId: id, status: "published" });
  });

  it("republishes a retained slot without needing another slot", async () => {
    const created = (await publish().then((r) => r.json())) as { publicationId: string };
    await fetch(request("POST", `/publications/${created.publicationId}/unpublish`, { token }));
    const response = await fetch(
      request("POST", `/publications/${created.publicationId}/republish`, { token }),
    );
    expect(response.status).toBe(200);
  });

  it("removes public access and the stored snapshot on delete", async () => {
    const created = (await publish().then((r) => r.json())) as { publicationId: string };
    const id = created.publicationId;

    expect((await fetch(request("DELETE", `/publications/${id}`, { token }))).status).toBe(204);
    expect(h.r2.objects.size).toBe(0);
    expect((await fetch(new Request(`https://publish.example/p/${id}`))).status).toBe(404);
  });

  it("reports the quota through the list endpoint", async () => {
    await publish();
    const list = (await fetch(request("GET", "/publications", { token })).then((r) =>
      r.json(),
    )) as { used: number; activeUsed: number; storedBytes: number; limit: number; publications: unknown[] };
    expect(list).toMatchObject({ used: 1, activeUsed: 1, limit: PUBLICATION_LIMIT });
    expect(list.storedBytes).toBeGreaterThan(0);
    expect(list.publications).toHaveLength(1);
  });

  it("does not spend a daily write credit for an identical update", async () => {
    const created = (await publish().then((r) => r.json())) as { publicationId: string };
    const first = h.db.db.prepare("SELECT writes FROM publish_usage WHERE owner_id = 'usr_test'").get() as { writes: number };
    const response = await fetch(request("PUT", `/publications/${created.publicationId}`, { token, body: { scape: scape() } }));
    expect(response.status).toBe(200);
    const second = h.db.db.prepare("SELECT writes FROM publish_usage WHERE owner_id = 'usr_test'").get() as { writes: number };
    expect(second.writes).toBe(first.writes);
    expect(h.r2.objects.size).toBe(1);
  });

  it("enforces the per-account daily write budget", async () => {
    const created = (await publish().then((r) => r.json())) as { publicationId: string };
    for (let i = 0; i < 19; i++) {
      const edited = fixtureScape(); edited.objects.brief.title = `revision ${i}`;
      expect((await fetch(request("PUT", `/publications/${created.publicationId}`, { token, body: { scape: projectScape(edited).scape } }))).status).toBe(200);
    }
    const edited = fixtureScape(); edited.objects.brief.title = "over budget";
    const response = await fetch(request("PUT", `/publications/${created.publicationId}`, { token, body: { scape: projectScape(edited).scape } }));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: "daily_write_limit" });
  });

  it("enforces current snapshot storage before it writes to R2", async () => {
    const now = Date.now();
    h.db.db.prepare("INSERT INTO publications (publication_id, owner_id, status, version, hash, current_bytes, updated_at, created_at) VALUES (?, 'usr_test', 'unpublished', 1, ?, ?, ?, ?)").run("pub_00000000000000000000000000", "b".repeat(64), 100 * 1024 * 1024, now, now);
    const response = await publish();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "storage_limit" });
    expect(h.r2.objects.size).toBe(0);
  });
});

describe("administration and suspension", () => {
  const admin = async () => {
    const session = await seedSession(h.db, { userId: "usr_admin", email: "admin@example.com", token: "a".repeat(40) });
    h.db.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(session.userId);
    return session;
  };

  it("denies every admin endpoint to a member", async () => {
    const { token } = await seedSession(h.db);
    expect((await fetch(request("GET", "/admin", { token }))).status).toBe(403);
    expect((await fetch(request("POST", "/admin/invites", { token, body: { email: "new@example.com" } }))).status).toBe(403);
  });

  it("audits an invitation and can revoke it", async () => {
    const { token } = await admin();
    expect((await fetch(request("POST", "/admin/invites", { token, body: { email: "New@Example.com" } }))).status).toBe(201);
    expect(h.db.count("invites", "email = 'new@example.com' AND status = 'pending'")).toBe(1);
    expect(h.db.count("admin_audit", "action = 'invite.created'")).toBe(1);
    expect((await fetch(request("DELETE", "/admin/invites/new%40example.com", { token }))).status).toBe(204);
    expect(h.db.count("admin_audit", "action = 'invite.revoked'")).toBe(1);
  });

  it("suspends a member immediately for list and mutation requests", async () => {
    const { token: adminToken } = await admin();
    const member = await seedSession(h.db, { userId: "usr_member", email: "member@example.com", token: "m".repeat(40) });
    expect((await fetch(request("POST", `/admin/members/${member.userId}/suspend`, { token: adminToken }))).status).toBe(200);
    expect((await fetch(request("GET", "/publications", { token: member.token }))).status).toBe(403);
    expect((await fetch(request("POST", "/publications", { token: member.token, body: { scape: scape() } }))).status).toBe(403);
    expect(h.db.count("admin_audit", "action = 'member.suspend'")).toBe(1);
  });

  it("does not allow one administrator to suspend another", async () => {
    const { token } = await admin();
    const second = await seedSession(h.db, { userId: "usr_second_admin", email: "second@example.com", token: "s".repeat(40) });
    h.db.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(second.userId);
    expect((await fetch(request("POST", `/admin/members/${second.userId}/suspend`, { token }))).status).toBe(403);
    expect(h.db.count("admin_audit")).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Owner isolation — asserted per handler, never via shared middleware         */
/* -------------------------------------------------------------------------- */

describe("owner isolation", () => {
  let mine: string;
  let theirs: string;
  let id: string;

  beforeEach(async () => {
    ({ token: mine } = await seedSession(h.db, { userId: "usr_a", token: "a".repeat(40) }));
    ({ token: theirs } = await seedSession(h.db, {
      userId: "usr_b",
      email: "b@example.com",
      token: "b".repeat(40),
    }));
    const created = (await fetch(
      request("POST", "/publications", { token: mine, body: { scape: scape() } }),
    ).then((r) => r.json())) as { publicationId: string };
    id = created.publicationId;
  });

  /** Each mutating route is asserted individually: a shared guard is one a route can forget. */
  const routes: Array<[string, string, unknown?]> = [
    ["PUT", "", { scape: null }],
    ["POST", "/unpublish"],
    ["POST", "/republish"],
    ["DELETE", ""],
  ];

  for (const [method, suffix] of routes) {
    it(`refuses ${method} /publications/:id${suffix} from another owner`, async () => {
      const response = await fetch(
        request(method, `/publications/${id}${suffix}`, {
          token: theirs,
          ...(method === "PUT" ? { body: { scape: scape() } } : {}),
        }),
      );
      expect(response.status).toBe(404);
      // Still published, still owned by the original user.
      expect(h.db.count("publications", "owner_id = 'usr_a' AND status = 'published'")).toBe(1);
    });
  }

  it("does not list another owner's publications", async () => {
    const list = (await fetch(request("GET", "/publications", { token: theirs })).then((r) =>
      r.json(),
    )) as { publications: unknown[]; used: number };
    expect(list.publications).toHaveLength(0);
    expect(list.used).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Projection validation                                                       */
/* -------------------------------------------------------------------------- */

describe("projection validation", () => {
  let token: string;
  beforeEach(async () => {
    ({ token } = await seedSession(h.db));
  });

  const post = (body: unknown) => fetch(request("POST", "/publications", { token, body }));

  it("rejects an object type that is not on the server's allowlist", async () => {
    const payload = scape();
    payload.objects.push({ id: "x", type: "hologram", title: "", data: {}, x: 0, y: 0 });
    expect((await post({ scape: payload })).status).toBe(422);
  });

  it("rejects a string over its declared limit", async () => {
    const payload = scape();
    payload.name = "x".repeat(5000);
    expect((await post({ scape: payload })).status).toBe(422);
  });

  it("rejects more objects than the cap allows", async () => {
    const payload = scape();
    payload.objects = Array.from({ length: 600 }, (_, i) => ({
      id: `o${i}`,
      type: "note",
      title: "n",
      data: { body: "" },
      x: 0,
      y: 0,
    }));
    expect((await post({ scape: payload })).status).toBe(422);
  });

  it("rejects an oversized body without trusting Content-Length", async () => {
    // A chunked request carries no Content-Length, which is why the Worker buffers and measures
    // instead of reading the header.
    const payload = scape();
    payload.objects[0].data = { body: "x".repeat(3 * 1024 * 1024) };
    const response = await post({ scape: payload });
    expect([413, 422]).toContain(response.status);
  });

  it("rejects a payload that is not an object at all", async () => {
    expect((await post({ scape: "nope" })).status).toBe(422);
    expect((await post(null)).status).toBe(422);
  });

  it("drops a relationship whose endpoint is missing rather than failing the publish", async () => {
    const payload = scape();
    payload.relationships.push({ id: "dangling", from: payload.objects[0].id, to: "ghost" });

    const created = (await post({ scape: payload }).then((r) => r.json())) as {
      publicationId: string;
    };
    const stored = JSON.parse(
      h.r2.objects.get(`publications/${created.publicationId}/v1/scape.json`)!,
    ) as { relationships: Array<{ id: string }> };
    expect(stored.relationships.map((rel) => rel.id)).not.toContain("dangling");
  });
});

/* -------------------------------------------------------------------------- */
/* Public reads                                                                */
/* -------------------------------------------------------------------------- */

describe("public reads", () => {
  let token: string;
  let id: string;

  beforeEach(async () => {
    ({ token } = await seedSession(h.db));
    const created = (await fetch(
      request("POST", "/publications", { token, body: { scape: scape() } }),
    ).then((r) => r.json())) as { publicationId: string };
    id = created.publicationId;
  });

  it("serves the pointer with no auth, no-store, and open CORS", async () => {
    const response = await fetch(new Request(`https://publish.example/p/${id}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const pointer = (await response.json()) as { version: number; snapshotPath: string };
    expect(pointer.version).toBe(1);
    expect(pointer.snapshotPath).toBe(`/p/${id}/v1/scape.json`);
  });

  it("serves the versioned snapshot as immutable, so the edge can cache it", async () => {
    const response = await fetch(new Request(`https://publish.example/p/${id}/v1/scape.json`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("immutable");
    expect(((await response.json()) as { objects: unknown[] }).objects).toHaveLength(12);
  });

  it("returns 404 for an id that never existed", async () => {
    const response = await fetch(
      new Request("https://publish.example/p/pub_00000000000000000000000000"),
    );
    expect(response.status).toBe(404);
  });

  it("returns 410 once unpublished, so the viewer can say which happened", async () => {
    await fetch(request("POST", `/publications/${id}/unpublish`, { token }));
    const response = await fetch(new Request(`https://publish.example/p/${id}`));
    expect(response.status).toBe(410);
  });
});

/* -------------------------------------------------------------------------- */
/* Account deletion, CORS, rate limits                                         */
/* -------------------------------------------------------------------------- */

describe("DELETE /account", () => {
  it("leaves no user, session, publication, or stored object behind", async () => {
    const { token } = await seedSession(h.db);
    await fetch(request("POST", "/publications", { token, body: { scape: scape() } }));
    expect(h.r2.objects.size).toBe(1);

    expect((await fetch(request("DELETE", "/account", { token }))).status).toBe(204);

    expect(h.db.count("users")).toBe(0);
    expect(h.db.count("sessions")).toBe(0);
    expect(h.db.count("publications")).toBe(0);
    expect(h.db.count("exchange_codes")).toBe(0);
    expect(h.r2.objects.size).toBe(0);
  });
});

describe("CORS and rate limiting", () => {
  it("refuses a mutation from an origin that is not the app", async () => {
    const { token } = await seedSession(h.db);
    const response = await fetch(
      request("POST", "/publications", {
        token,
        body: { scape: scape() },
        origin: "https://evil.example",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 429 when the rate limiter says no", async () => {
    const { token } = await seedSession(h.db);
    h.allowRequests.value = false;
    const response = await fetch(request("POST", "/publications", { token, body: { scape: scape() } }));
    expect(response.status).toBe(429);
  });

  it("rate-limits the unauthenticated public read, which costs a D1 and an R2 hit", async () => {
    h.allowRequests.value = false;
    const response = await fetch(
      new Request("https://publish.example/p/pub_00000000000000000000000000"),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("the cron sweeper", () => {
  it("deletes superseded snapshots once they are due", async () => {
    const { token } = await seedSession(h.db);
    const created = (await fetch(
      request("POST", "/publications", { token, body: { scape: scape() } }),
    ).then((r) => r.json())) as { publicationId: string };

    const edited = fixtureScape();
    edited.objects.brief.title = "Revised";
    await fetch(
      request("PUT", `/publications/${created.publicationId}`, {
        token,
        body: { scape: projectScape(edited).scape },
      }),
    );
    expect(h.r2.objects.size).toBe(2);

    h.db.db.prepare("UPDATE superseded_versions SET delete_after = ?").run(Date.now() - 1);
    await worker.scheduled({} as never, h.env as never);

    expect(h.r2.objects.size).toBe(1);
    expect(h.r2.objects.has(`publications/${created.publicationId}/v2/scape.json`)).toBe(true);
    expect(h.db.count("superseded_versions")).toBe(0);
  });

  it("backfills byte counts for pre-quota publications from R2 metadata", async () => {
    const now = Date.now();
    const id = "pub_11111111111111111111111111";
    const snapshot = JSON.stringify(scape());
    await seedSession(h.db, { userId: "usr_legacy", email: "legacy@example.com", token: "l".repeat(40) });
    h.db.db.prepare("INSERT INTO publications (publication_id, owner_id, status, version, hash, current_bytes, updated_at, created_at) VALUES (?, 'usr_legacy', 'published', 1, ?, 0, ?, ?)").run(id, "c".repeat(64), now, now);
    await h.r2.put(`publications/${id}/v1/scape.json`, snapshot);
    await worker.scheduled({} as never, h.env as never);
    const row = h.db.db.prepare("SELECT current_bytes FROM publications WHERE publication_id = ?").get(id) as { current_bytes: number };
    expect(row.current_bytes).toBe(new TextEncoder().encode(snapshot).byteLength);
  });
});
