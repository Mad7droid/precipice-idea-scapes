import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Read-only checks against the deployed release; no account, OAuth grant, or snapshot needed.
const app = process.env.APP_ORIGIN ?? "https://precipice.pages.dev";
const mcp = process.env.VITE_MCP_URL;
const publication = process.env.VITE_PUBLICATION_API_URL;
assert(mcp && publication, "Set VITE_MCP_URL and VITE_PUBLICATION_API_URL.");
const expected = readFileSync("dist/index.html", "utf8").match(
  /src="(\/assets\/main-[^"]+\.js)"/,
)?.[1];
assert(expected, "Build dist before checking a deployed release.");

let editor;
let html;
for (let attempt = 0; attempt < 12; attempt++) {
  editor = await fetch(`${app}/`, { cache: "no-store" });
  html = await editor.text();
  if (editor.ok && html.includes(expected)) break;
  if (attempt < 11) await new Promise((resolve) => setTimeout(resolve, 5000));
}
assert.equal(editor.status, 200);
assert(html.includes(expected), "Production must serve the just-built editor bundle.");
const csp = editor.headers.get("content-security-policy");
assert(csp?.includes(mcp));
assert(csp.includes(`wss://${new URL(mcp).host}`));
assert(csp.includes("frame-ancestors 'none'"));
const bundle = await fetch(app + expected);
assert.equal(bundle.status, 200);
const js = await bundle.text();
assert(js.includes(mcp) && js.includes(publication));
console.log("PASS current editor bundle, production endpoints, and relay CSP");

const fictionalId = `pub_${"0".repeat(26)}`;
for (const [route, policy] of [
  ["p", "frame-ancestors 'none'"],
  ["embed", "frame-ancestors *"],
]) {
  const response = await fetch(`${app}/${route}/${fictionalId}`);
  assert.equal(response.status, 200);
  assert(response.headers.get("content-security-policy")?.includes(policy));
  assert((await response.text()).includes("/assets/view-"));
  console.log(`PASS /${route} viewer rewrite and frame policy`);
}
const missing = await fetch(`${publication}/p/${fictionalId}`);
assert.equal(missing.status, 404);
console.log("PASS fictional missing public snapshot returns 404");

const denied = await fetch(`${mcp}/mcp`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "release-smoke", version: "1" },
    },
  }),
});
assert.equal(denied.status, 401);
const metadataUrl = denied.headers
  .get("www-authenticate")
  ?.match(/resource_metadata="([^"]+)"/)?.[1];
assert(metadataUrl, "MCP must advertise its protected-resource metadata.");
const metadata = await fetch(metadataUrl);
assert.equal(metadata.status, 200);
assert.equal((await metadata.json()).resource, `${mcp}/mcp`);
const auth = await fetch(`${mcp}/.well-known/oauth-authorization-server`);
assert.equal(auth.status, 200);
const configuration = await auth.json();
assert.equal(configuration.issuer, mcp);
assert(configuration.code_challenge_methods_supported.includes("S256"));
console.log("PASS MCP authorization challenge, discovery, and PKCE");
