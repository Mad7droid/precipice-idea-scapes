// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import type { IncomingMessage } from "node:http";
import {
  authorizationUrl,
  allowedLocalRequest,
  callbackClient,
  validateIdentity,
  validateTokens,
} from "./chatgpt-local";

const pending = {
  state: "fictional-state",
  nonce: "fictional-nonce",
  verifier: "fictional-verifier",
  redirect: "http://127.0.0.1:5173/__chatgpt/callback",
  expires: Date.now() + 60_000,
};
describe("local subscription authentication", () => {
  it("uses fresh registration, PKCE and the exact loopback callback", () => {
    const url = new URL(authorizationUrl("urn:uuid:fictional-host", pending));
    expect(url.origin).toBe("https://auth.openai.com");
    expect(url.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).not.toBe(pending.verifier);
    expect(url.searchParams.get("redirect_uri")).toBe(pending.redirect);
    expect(url.searchParams.get("scope")).toContain("chatgpt.tokens.use.direct");
    const returning = new URL(authorizationUrl("host", { ...pending, client: "oaiapp_saved" }));
    expect(returning.searchParams.has("agent_name_hint")).toBe(false);
  });
  it("rejects missing/wrong state, expired attempts, denied consent and changed clients", () => {
    for (const query of [
      "code=a",
      "state=wrong&code=a",
      "state=fictional-state&error=access_denied",
      "state=fictional-state&code=a&client_id=dynamic_agent_client",
    ]) {
      expect(() =>
        callbackClient(new URL(`http://127.0.0.1/callback?${query}`), pending),
      ).toThrow();
    }
    const url = new URL(
      "http://127.0.0.1/callback?state=fictional-state&code=a&client_id=oaiapp_new",
    );
    expect(() => callbackClient(url, { ...pending, expires: 0 })).toThrow();
    expect(() => callbackClient(url, { ...pending, client: "oaiapp_saved" })).toThrow();
    expect(callbackClient(url, pending)).toEqual({ client: "oaiapp_new", code: "a" });
  });
  it("blocks cross-origin mutations and Host-header rebinding", () => {
    const origin = "http://127.0.0.1:5173";
    const request = (host: string, from?: string) =>
      ({ headers: { host, origin: from } }) as IncomingMessage;
    expect(allowedLocalRequest(request("127.0.0.1:5173", origin), origin, true)).toBe(true);
    expect(allowedLocalRequest(request("evil.test", origin), origin, true)).toBe(false);
    expect(allowedLocalRequest(request("127.0.0.1:5173", "http://evil.test"), origin, true)).toBe(
      false,
    );
    expect(allowedLocalRequest(request("127.0.0.1:5173"), origin, true)).toBe(false);
  });
  it("does not mistake identity scopes for inference authorization", () => {
    const tokens = {
      access_token: "fictional-access",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid profile email",
    };
    expect(() => validateTokens(tokens)).toThrow("permission");
    expect(
      validateTokens({ ...tokens, scope: "openid chatgpt.tokens.use.direct" }).access_token,
    ).toBe("fictional-access");
  });
  it("cryptographically validates issuer, audience, expiry, nonce and returning identity", async () => {
    const keys = await generateKeyPair("RS256");
    const sign = (issuer = "https://auth.openai.com", audience = "oaiapp_test", expires = "5m") =>
      new SignJWT({ sub: "account-a", nonce: pending.nonce })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer(issuer)
        .setAudience(audience)
        .setExpirationTime(expires)
        .sign(keys.privateKey);
    const getKey = async () => keys.publicKey;
    const token = await sign();
    expect(
      (await validateIdentity(token, "oaiapp_test", pending.nonce, undefined, getKey)).sub,
    ).toBe("account-a");
    await expect(
      validateIdentity(token, "oaiapp_wrong", pending.nonce, undefined, getKey),
    ).rejects.toThrow();
    await expect(
      validateIdentity(token, "oaiapp_test", "wrong", undefined, getKey),
    ).rejects.toThrow();
    await expect(
      validateIdentity(token, "oaiapp_test", pending.nonce, "account-b", getKey),
    ).rejects.toThrow();
    await expect(
      validateIdentity(
        await sign("https://evil.test"),
        "oaiapp_test",
        pending.nonce,
        undefined,
        getKey,
      ),
    ).rejects.toThrow();
    await expect(
      validateIdentity(
        await sign(undefined, undefined, "-1h"),
        "oaiapp_test",
        pending.nonce,
        undefined,
        getKey,
      ),
    ).rejects.toThrow();
  });
});
