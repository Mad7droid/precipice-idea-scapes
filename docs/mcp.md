# Agents and MCP

Precipice exposes the same validated command service through a hosted MCP connector and the
macOS app's built-in local server. Open **Agents** in the library sidebar or **Settings → Agents** in an editor.
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
Client setup instructions are supplied for Claude, Claude Code, Codex, ChatGPT, and Cursor.
The production connector is `https://precipice-mcp.precipice.workers.dev/mcp`. Reconnect or
refresh the client’s tool definitions after an update if `preview_flow` is missing.
External-client acceptance testing is tracked in the [release record](releases/0.1.6.md);
unit tests alone do not establish that a particular client renders MCP Apps.

## Tools and review

### Flow previews in chat

For new flows, use `preview_flow` with a name and a validated action batch; omit `scape_id`.
For changes to a scape, pass its ID. The tool registers a sandboxed MCP Apps resource
(`text/html;profile=mcp-app`) with `_meta.ui.resourceUri`, plus ChatGPT compatibility metadata.
Claude and ChatGPT hosts that support MCP Apps can show the connected flow map, inspectable
notes, journey steps, and wireframe screens directly in the conversation.

No empty scape is created while drafting. The exact batch and base revision are held in a
local durable receipt for ten minutes. **Create in Precipice** applies that batch atomically,
including engine-computed layout, with the usual undo history. This explicit chat confirmation
fulfills content review even for review-mode connections. A changed target, expired preview,
read-only connection, or mismatched connection/host/capability cannot confirm it. The app-only
`confirm_flow` tool takes a private capability delivered in UI metadata, never replacement
actions. It cannot approve deletion, publication, or another pending request. Existing tools
and their in-app review behavior remain available to text-only clients.

Preview navigation and rendering make no model calls. The model receives a compact status and
counts; full block data and the confirmation capability travel in tool-result `_meta`, not
`content` or `structuredContent`. Preview HTML is self-contained and loads no remote assets.
The standard `ui/initialize`, tool-result notifications, and `tools/call` bridge are shared by
both hosts. Standard app-only visibility is accompanied by ChatGPT compatibility metadata.
Only `preview_flow` opens the widget; confirmation and status tools do not replace it. Live acceptance in each external client remains a release requirement.

### Shareable iframe previews

**Share preview → Make preview public** is a separate, explicit disclosure action. It shares
the entire displayed draft, including existing blocks when previewing an edit, as an unlisted,
read-only publication without adding a scape to the local library. It uses the existing bounded
publication projection, sign-in/invite rules, quotas, hosted canvas, and `/embed/<publicationId>`
route. Instructions, history, local metadata, and credentials are excluded from that projection.
The result provides a hosted share URL and copyable iframe code:

```html
<iframe src="https://precipice.pages.dev/embed/PUBLICATION_ID"
  title="Precipice flow preview" width="100%" height="600"
  loading="lazy" referrerpolicy="no-referrer" style="border:0"></iframe>
```

Shared snapshots are independent of creation and remain available after the draft expires.
They consume a retained publication slot and can be withdrawn from the chat preview. Use
**Refresh status** to recover the share link and withdrawal control after the UI reloads.
Owners can also manage retained snapshots through the authenticated publication API. The iframe is read-only and has no access to the local
library or chat confirmation capability. Re-sharing the same draft returns its existing link;
withdrawal is allowed after the creation preview expires. No new service or worktree is needed.

Standards: [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) and
[ChatGPT MCP UI](https://developers.openai.com/plugins/build/chatgpt-ui).

Tools cover capabilities, explicit scape selection, paginated reads, search/fetch, instructions,
preview/apply, layout, focus, operation outcomes/cancel/revert, create/duplicate/delete, and
export. Inspect `src/mcp/contracts.ts` for the shared schemas. Server instructions and prompts
explain the object model. The general `publish_scape` and `unpublish_scape` tools require explicit in-app confirmation and use the same bounded
projection and quotas as the Publish panel. Local-only desktop users must connect their account
before publishing.

Changes pass through `applyAction`. An applied batch is one undoable transaction. Review cards
appear above the canvas and survive a reload until they expire. Use `get_operation` to learn
whether a reviewed command was applied or declined. Clients should reuse an idempotency key
when retrying a write, and send `expected_revision` when relying on a prior read.

### Recovery and text-only clients

- Keep the chosen library host open. An unavailable host returns an error without queuing a write.
- If a creation response times out, choose **Refresh status** before retrying. Confirmation is
  tied to the receipt, so a retry returns the existing outcome.
- If the scape changed or the draft expired, request a fresh preview. No replacement actions
  can be submitted through the confirmation tool.
- Use **Refresh status** to retrieve a shared link and withdraw it after the creation draft
  expires. A withdrawn snapshot keeps its retained slot; re-sharing an unexpired draft restores
  the same URL. Account publication deletion frees the slot.
- The library’s **Published** page lists snapshots attached to saved scapes. Unsaved chat
  preview snapshots are managed from their chat preview or the authenticated publication API.
- A text-only client should use `create_scape`/`apply_changes` with in-app review. App-only
  confirmation tools are intentionally unavailable to the model.

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

### Troubleshooting local setup

- Confirm the client entry runs `/Applications/Precipice.app/Contents/MacOS/precipice-desktop`
  with `--mcp` (adjust the path if installed elsewhere).
- Replace older entries pointing to `node .../mcp/server.mjs` using **Add** in Agents. Those
  entries reference the legacy bridge and can break when a development workspace is removed.
- Restart the client after changing its configuration. Test a library read and then a reviewed
  edit; merely seeing the server listed does not prove end-to-end connectivity.
- Do not solve duplicate-client launches by killing whichever process loses a TCP-port race.
  The built-in helper supports separate stdio clients connected to the same desktop app.
- Keep private scape contents, client config credentials, and logs out of public bug reports.

### Legacy harness

Run `pnpm mcp`, or register `node /absolute/path/mcp/server.mjs` with a local MCP client.
Development builds expose the legacy pairing panel under **Agents → Developer bridge**.
Run `pnpm verify`, `pnpm test:mcp`, `pnpm check:worker`, and the macOS Rust/build checks before release.
