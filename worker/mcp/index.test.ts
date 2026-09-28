// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { TestD1 } from "../publish/harness";
vi.mock("@cloudflare/workers-oauth-provider", () => ({ OAuthProvider: class {} }));
vi.mock("./relay", () => ({ McpRelay: class {} }));
import { __app, __mcpApi, mintTicket, readTicket, takeBudget, type Env } from "./index";

const APP = "https://app.example";
const TOKEN = "test_session_aaaaaaaaaaaaaaaaaaaaaaaa";
const requestId = "car_aaaaaaaaaaaaaaaaaa";
let db: TestD1;
let env: Env;
const request = (path: string, method = "GET", body?: unknown, origin = APP) =>
  new Request(`https://mcp.example${path}`, {
    method,
    headers: {
      Origin: origin,
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const approval = { scapes: "all", mode: "review", write: true };
function seedRequest() {
  db.db.prepare("INSERT INTO mcp_auth_requests VALUES (?, ?, ?)").run(
    requestId,
    JSON.stringify({
      authRequest: {
        clientId: "client",
        redirectUri: "https://client.example/callback",
        state: "state",
      },
      clientName: "Test client",
      clientUri: null,
      redirectHost: "client.example",
    }),
    Date.now() + 60_000,
  );
}
beforeEach(() => {
  db = new TestD1();
  db.db
    .prepare(
      "INSERT INTO users (id, google_sub, email, display_name, role, status, created_at, updated_at) VALUES ('u1', 'sub1', 'test@example.com', 'Test', 'member', 'active', 0, 0)",
    )
    .run();
  db.db
    .prepare(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES ('s1', 'u1', ?, ?, 0)",
    )
    .run(createHash("sha256").update(TOKEN).digest("hex"), Date.now() + 60_000);
  env = {
    APP_ORIGIN: APP,
    TICKET_SECRET: "x".repeat(40),
    PUBLISH_DB: db as unknown as D1Database,
    OAUTH_PROVIDER: {
      completeAuthorization: vi.fn(async () => ({
        redirectTo: "https://client.example/callback?code=test",
      })),
      listUserGrants: vi.fn(async () => ({ items: [] })),
      revokeGrant: vi.fn(),
    },
  } as unknown as Env;
});

describe("hosted connector security", () => {
  it("expires and authenticates relay tickets", async () => {
    const ticket = await mintTicket(env, "u1", 1000);
    expect(await readTicket(env, ticket, 1001)).toBe("u1");
    expect(await readTicket(env, ticket, 61000)).toBeNull();
    expect(await readTicket(env, ticket + "x", 1001)).toBeNull();
    expect(await readTicket(env, "junk", 1001)).toBeNull();
  });
  it("refuses to mint or accept tickets without a configured secret", async () => {
    const unset = { ...env, TICKET_SECRET: undefined as unknown as string };
    await expect(mintTicket(unset, "u1")).rejects.toThrow();
    const ticket = await mintTicket(env, "u1", 1000);
    await expect(readTicket(unset, ticket, 1001)).rejects.toThrow();
  });
  it("requires the app origin and an active invited account", async () => {
    expect(
      (await __app(request("/relay/ticket", "POST", undefined, "https://evil.example"), env))
        .status,
    ).toBe(403);
    db.db.prepare("UPDATE users SET status = 'suspended'").run();
    expect((await __app(request("/relay/ticket", "POST"), env)).status).toBe(403);
  });
  it("preserves a pending request on invalid input, then consumes it exactly once", async () => {
    seedRequest();
    expect(
      (await __app(request(`/connect/requests/${requestId}/approve`, "POST", {}), env)).status,
    ).toBe(400);
    expect(db.count("mcp_auth_requests")).toBe(1);
    const responses = await Promise.all(
      [1, 2].map(() =>
        __app(request(`/connect/requests/${requestId}/approve`, "POST", approval), env),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 404]);
    expect(db.count("mcp_connections")).toBe(1);
    expect(env.OAUTH_PROVIDER.completeAuthorization).toHaveBeenCalledTimes(1);
  });
  it("denial returns only the registered callback and preserves state", async () => {
    seedRequest();
    const response = await __app(request(`/connect/requests/${requestId}/deny`, "POST"), env);
    expect(await response.json()).toEqual({
      redirectTo: "https://client.example/callback?error=access_denied&state=state",
    });
    expect(db.count("mcp_connections")).toBe(0);
  });
  it("revokes a connection immediately without affecting another user", async () => {
    seedRequest();
    await __app(request(`/connect/requests/${requestId}/approve`, "POST", approval), env);
    const id = (db.db.prepare("SELECT id FROM mcp_connections").get() as { id: string }).id;
    expect((await __app(request(`/connect/connections/${id}`, "DELETE"), env)).status).toBe(204);
    expect(db.count("mcp_connections")).toBe(0);
    const response = await __mcpApi.fetch(request("/mcp", "POST", {}), env, {
      props: {
        userId: "u1",
        connectionId: id,
        grant: { clientId: "c", clientName: "Test", ...approval },
      },
    } as never);
    expect(response.status).toBe(401);
  });
  it("enforces an atomic deployment-wide daily cap and resets next UTC day", async () => {
    const now = Date.UTC(2026, 8, 28);
    expect(await takeBudget(env, now)).toBe(true);
    db.db.prepare("UPDATE mcp_budget SET requests = 24999").run();
    expect(await Promise.all([takeBudget(env, now), takeBudget(env, now)])).toEqual([true, false]);
    expect(await takeBudget(env, now + 86400000)).toBe(true);
    expect(db.count("mcp_budget")).toBe(1);
  });
  it("the kill switch blocks app and MCP calls", async () => {
    env.MCP_DISABLED = "1";
    expect((await __app(request("/relay/ticket", "POST"), env)).status).toBe(503);
    expect((await __mcpApi.fetch(request("/mcp"), env, {} as never)).status).toBe(503);
  });
});

it("desktop sign-in requires its PKCE verifier and never reuses a code", async () => {
  const { approveHost, exchangeHost, digest, hostUser } = await import("./hostAuth");
  const verifier = "a".repeat(64);
  const callback = await approveHost(env, "u1", await digest(verifier));
  const code = new URL(callback!).searchParams.get("code");
  expect(await exchangeHost(env, { code, verifier: "b".repeat(64) })).toBeNull();
  const credential = await exchangeHost(env, { code, verifier });
  expect(credential?.token).toBeTruthy();
  expect(await exchangeHost(env, { code, verifier })).toBeNull();
  const user = await hostUser(
    new Request("https://mcp.example/relay/ticket", {
      headers: { Authorization: `Bearer ${credential!.token}` },
    }),
    env,
  );
  expect(user).toMatchObject({ id: "u1", host: "desktop" });
});
