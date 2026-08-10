import { describe, expect, it } from "vitest";
import worker, { safeReturn } from "./index";

const env = {
  APP_ORIGIN: "https://precipice.pages.dev",
  GOOGLE_CLIENT_ID: "test-client",
  GOOGLE_CLIENT_SECRET: "test-secret",
  PUBLISH_LIMIT: { limit: async () => ({ success: true }) },
  // The public missing route reads exactly one D1 row. Keeping this fake deliberately small
  // makes the test exercise the HTTP boundary without pretending to be local D1.
  PUBLISH_DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) },
  PUBLICATIONS: {},
};

describe("publication Worker security boundaries", () => {
  it("pins OAuth return values to safe paths", () => {
    expect(safeReturn("/s/scape-1")).toBe("/s/scape-1");
    expect(safeReturn("//evil.example")).toBe("/");
    expect(safeReturn("/\\evil.example")).toBe("/");
    expect(safeReturn("https://evil.example")).toBe("/");
    expect(safeReturn(`/p/${"x".repeat(201)}`)).toBe("/");
  });

  it("keeps public pointer reads unauthenticated and CORS-readable", async () => {
    const response = await worker.fetch(
      new Request("https://publish.example/p/pub_00000000000000000000000000"),
      env as never,
      { waitUntil: () => undefined },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("allows the top-level OAuth start navigation without an Origin header", async () => {
    const authEnv = {
      ...env,
      PUBLISH_DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) },
    };
    const response = await worker.fetch(
      new Request("https://publish.example/auth/start?return=/s/scape-1"),
      authEnv as never,
      { waitUntil: () => undefined },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("accounts.google.com");
  });
});
