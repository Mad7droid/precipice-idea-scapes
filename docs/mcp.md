# Agents and MCP

Precipice exposes the same validated command service through a hosted MCP connector and the
macOS app's built-in local server. Open **Settings → Agents** from the library or an editor.
Choose a client and follow its setup instructions. The old Node bridge remains a development
harness; it is not required for desktop users.

## On this Mac

Install Precipice in a stable location, such as `/Applications/Precipice.app`. In Agents, choose
Claude Desktop, Codex, or Cursor and click **Add**. The app updates only its own server entry
in that client's configuration. Restart the client or start a new session once after setup.
Claude Code has a copyable registration command.

Clients run the app executable with `--mcp`. It starts Precipice in the background if necessary
and connects through a user-private Unix socket. If Precipice quits, the helper keeps running;
the agent's next message relaunches the app and replays the MCP handshake (under a private
request id whose reply is dropped), so agents that never restart servers stay connected. There
are no TCP ports, pairing codes, Node installation, or accounts. The first local write asks for review. Choose **Always apply changes from this agent** for
subsequent writes, or configure the local review policy in Agents. Deleting a scape always
requires review. Local access grants access to this device's library, not the browser library.

## Hosted connector

Set `VITE_MCP_URL` to the connector's HTTPS origin when building the web app. Agents connects
clients to `<origin>/mcp` using Streamable HTTP and OAuth. The consent screen uses the same
Google sign-in and invite gate as publishing, and lets the person choose all or selected
scapes, read-only or edit access, and review or immediate application. Remove one or all
connections from Agents to revoke subsequent calls immediately.

Keep Precipice open in the browser that holds the library. Its relay reconnects after network
loss and tab activation; idle sockets do not poll. Closing all hosts returns an actionable
unavailable result and never queues a write. Approving in another tab wakes the relay-owning
tab. OAuth refresh tokens last up to 90 days. Host credentials have a 90-day activity window and
renew on use, independently of the shorter publishing session.

For remote desktop access, choose **Anywhere → Connect this Mac**. Sign in through the system
browser; a PKCE-bound, single-use callback returns to the app and stores the host credential in
Keychain. Choose **Desktop app** when authorizing the agent. Browser and desktop grants route
to separate relay hosts, so one cannot take over the other's library. Desktop grants currently
cover the desktop library as a whole; browser grants can select individual scapes.
Client setup instructions are supplied for Claude, Claude Code, Codex, ChatGPT, and Cursor;
external-client acceptance testing is still a release requirement, not implied by unit tests.

## Tools and review

Tools cover capabilities, explicit scape selection, paginated reads, search/fetch, instructions,
preview/apply, layout, focus, operation outcomes/cancel/revert, create/duplicate/delete, and
export. Inspect `src/mcp/contracts.ts` for the shared schemas. Server instructions and prompts
explain the object model. Publishing and unpublishing always require explicit in-app confirmation and use the same bounded
projection and quotas as the Publish panel. Local-only desktop users must connect their account
before publishing.

Changes pass through `applyAction`. An applied batch is one undoable transaction. Review cards
appear above the canvas and survive a reload until they expire. Use `get_operation` to learn
whether a reviewed command was applied or declined. Clients should reuse an idempotency key
when retrying a write, and send `expected_revision` when relying on a prior read.

## Deploying the connector

1. Copy `wrangler.mcp.example.toml` to ignored `wrangler.mcp.toml`. Use the existing publishing
   D1 database; create an `OAUTH_KV` namespace and fill in its ID. Set the exact `APP_ORIGIN`.
2. Apply publishing migrations, including MCP migrations, before deploying the Worker.
3. Set a random `TICKET_SECRET` of at least 32 bytes using `wrangler secret put`
   (`openssl rand -hex 32`). The Worker refuses to mint or accept relay tickets without it.
4. Deploy using `pnpm exec wrangler deploy --config wrangler.mcp.toml`.
5. Set repository variable `VITE_MCP_URL` and secret `WRANGLER_MCP_CONFIG` for the deployment
   workflow. The config contains infrastructure identifiers, never the ticket secret.
6. Test authorization, tool reads, reviewed and immediate writes, revocation, tab takeover,
   offline errors, and client refresh before inviting users.

The authenticated MCP request budget is 25,000 per UTC day across the deployment, stored as one
atomic counter in D1. `MCP_DISABLED=1` stops the connector. Per-user tool limits also apply.
The cap is not a guarantee that all Cloudflare account usage fits the free tier: OAuth metadata,
registration, denied requests, other Workers, and publishing consume their own quotas. Keep the
account on the free plan and monitor usage; edge rate limiting may be needed for public abuse.
No billing upgrade is required or performed by this change.

## Developer bridge

Run `pnpm mcp`, or register `node /absolute/path/mcp/server.mjs` with a local MCP client.
Development builds expose the legacy pairing panel under **Agents → Developer bridge**.
Run `pnpm verify`, `pnpm test:mcp`, `pnpm check:worker`, and the macOS Rust/build checks before release.
