# Security and local data

Precipice is designed as a local-first workspace. Your Scapes are kept in the
browser that you use, while AI generation is an explicit request made with your
own Anthropic (Claude) API key.

## Where your data lives

- Scapes, object content, relationships, view state, and local settings are
  stored in the browser through IndexedDB.
- Precipice does not provide a shared server-side Scape database or account
  sync in the current hosted app.
- The hosted site does not upload a Scape merely because you open or edit it.
- Export a `.scape` file when you need a portable backup. Treat that file as
  sensitive if the Scape contains confidential information: it is not encrypted
  by Precipice.
- Browser storage is subject to the browser profile, extensions, operating
  system account, backups, and device security. “Local” does not mean encrypted
  or immune to malware.
- Home library preferences — the filter, sort, gallery/list view, pinned Scapes,
  and whether the explore section was dismissed — are stored with local settings
  in IndexedDB. They describe how you view your library, not what a Scape
  contains, so they are not written into a `.scape` export or a publication.
  Pinning a Scape does not change its content or its edited time.

## Durability and offline behavior

- Autosave writes locally without a Save button. When a Scape is open in more
  than one tab, only one tab holds the write lease; the others are read-only.
  Renaming or deleting a Scape from the home library acquires the same lease and
  fails with a clear message rather than writing behind a tab that holds it.
  Use **Edit here** to take over editing. Precipice does not merge simultaneous
  changes between tabs.
- After the first Scape is created, Precipice asks browsers that support it to
  mark the origin's storage as persistent. A browser may decline, private mode
  may restrict storage, and no browser setting replaces an exported backup.
- The action log is retained only up to a bounded size to reduce quota pressure;
  the current Scape snapshot is what reopens after refresh.
- The production app registers an offline app shell. After the app has loaded
  once, it can reopen without a network connection and still read local Scapes.
  It cannot generate with Anthropic while offline. Local development does not
  register this service worker.

## How the Claude/Anthropic key is handled

1. You enter your own Anthropic API key in **Settings → AI**.
2. The app keeps it in `sessionStorage`, not IndexedDB or the repository. It is
   available to the current browser tab session and is cleared when that tab
   session ends.
3. When you generate, the browser sends the key for that request to the
   Precipice Cloudflare Worker.
4. The Worker forwards the key to Anthropic for that request only. It does not
   hold a server-side Anthropic key, persist the user key, or store the Scape.
5. AI responses are returned with `Cache-Control: no-store`.

The Worker is a CORS relay, not an account or authorization boundary. Its
`Origin` allowlist controls browser CORS behavior; non-browser clients can forge
an `Origin`. This is safe for the product's intended model because the Worker
has no credential of its own, but it is not a substitute for user identity or
server-side authorization.

## What is sent to Anthropic

An AI generation request can include the prompt, the relevant Scape context,
and the user's API key. Do not put secrets, production credentials, customer
records, or regulated personal data into a prompt or Scape unless your own
Anthropic account and organizational policy allow that use.

Precipice does not claim that local browser storage or the AI provider provides
encryption, retention, or compliance guarantees for your particular use case.
Review Anthropic's current terms and privacy documentation for the account and
API plan you use.

## The macOS app, and what installing an update trusts

The Mac app is a separate local store from the browser: its Scapes, preferences, and key never
reach browser storage, and no route synchronizes the two. An Anthropic key is only written to the
login Keychain when you ask for it, as a non-synchronizing generic-password item under service
`dev.precipice.desktop.anthropic`. It is never written to a file, IndexedDB, an export, or a log.
Desktop AI calls reach Anthropic directly rather than through the Worker. See
[desktop notes](desktop.md) for the full native boundary.

Installing a build is the moment you extend trust, so treat it as a security step:

- Local builds are ad-hoc signed. Their code directory hash changes on every build, so macOS
  treats each build as a different app and asks for Keychain access again. That prompt is
  expected on a rebuild; a prompt you did not trigger by installing is not.
- The app version comes from `package.json` and is checked against `src-tauri/Cargo.toml` by
  `pnpm check:version`. Two builds that claim the same version cannot be told apart after
  installation, which is a problem for auditing what is running, not only for convenience.
- There is no in-app updater, and one should not be added before Developer ID signing and
  notarization exist. An updater downloads and runs code; without a stable signing identity
  and an update-manifest signature, installing an update would trust whatever the download
  endpoint served.
- Uninstalling the app does not remove its Keychain item. Remove the key in Settings first.

## Deployment and repository hygiene

- API keys, Cloudflare tokens, `.env` files, and private user data must never be
  committed to GitHub.
- The deployment workflow requires `CLOUDFLARE_ACCOUNT_ID` and
  `CLOUDFLARE_API_TOKEN` as GitHub Actions secrets, plus the ignored publication Worker
  configuration as `WRANGLER_PUBLISH_CONFIG`. Public build values belong in repository variables.
  The workflow fails before building or deploying when any required value is absent; do not add
  a fallback to source-controlled credentials.
- Production deployment credentials belong in GitHub Actions secrets or the
  local Wrangler credential store, not in source files. Use a scoped token with
  only the Workers and Pages permissions required for this project.
- `.env.example` contains placeholder public build settings, not credentials. `VITE_*` values
  are compiled into the client bundle and must never contain secrets.
- Keep Secret Scanning, push protection, and Dependabot enabled on the GitHub
  repository when available, including the non-provider pattern set and validity checks.
- Pin every GitHub Action to a full commit SHA, not a tag. A tag is mutable, and these
  workflows hold the Cloudflare deployment credentials. Record the intended version in a
  trailing comment so the pin stays reviewable, and keep SHA pinning required in the
  repository's Actions settings.
- Protect `main` against force pushes and deletion. A push to `main` deploys the Workers,
  applies publication database migrations, and publishes the site, so rewriting that branch
  rewrites production.
- Never paste a real API key into a screenshot, issue, pull request, chat log,
  test fixture, or exported documentation image.
- Publication sessions expire after seven days and are revoked immediately on logout, account
  suspension, or replacement by a newer sign-in.
- Agent host credentials (90 days, extended on use) let a tab or the Mac app open its relay and
  manage publications, never account or admin APIs. Logout revokes web host credentials and
  clears the browser copy. Desktop sign-out revokes this Mac's credential; account deletion,
  suspension, and credential expiry also restrict access.

## Operational protections

The Worker rejects requests without an allowed origin or API key, limits request
bodies to 256 KiB, forwards an explicit header allowlist, and applies best-effort
per-isolate request damping. The in-memory damping is not a dependable global
rate limit. Configure a Cloudflare edge rate-limit rule for `POST /v1/messages`
on the Worker hostname for authoritative capacity protection.

The Worker accepts the production Pages origin and `http` requests from
`localhost` or `127.0.0.1` on any port for local development. This local-origin
rule is a CORS convenience, not authentication: a non-browser caller can forge
an Origin header, and the Worker intentionally has no shared Anthropic key to
protect. Do not add a hosted provider key unless the Worker first gains real
user authentication, authorization, and abuse controls.

## If you suspect exposure

Immediately revoke the affected Anthropic key in the Anthropic console and
create a replacement. Then remove it from browser settings and any local files.
Do not publish the old key while reporting the incident. For a vulnerability in
Precipice itself, use the private process in [SECURITY.md](../SECURITY.md).

## Hosted MCP and local agents

The hosted MCP Worker shares publishing accounts and the invite gate. OAuth grants/tokens live
in KV; scoped connection records and expiring authorization requests live in D1. Scape content
passes through the relay in memory to the authorized client and is not persisted by the Worker.
Operation receipts and pending reviews remain in the local IndexedDB library. Every hosted call
checks the connection and account status; revocation prevents subsequent calls, but cannot
recall content already returned or undo an in-flight write. Consent requests are consumed once.
A global authenticated-request counter limits daily MCP work; public OAuth endpoints still need
operational monitoring. Configure only the exact app origin for app-facing requests.

Desktop local MCP uses the app's `--mcp` stdio mode and a socket in its user-private application
support directory (directory 0700, socket 0600). It authorizes same-user local processes, not
remote web content. Local MCP has the library access explicitly enabled in Agents and shares
one local review policy. The app can update its entry in supported client configuration files
when the user presses Add; unrelated client settings must be preserved. Desktop host credentials live in a separate Keychain item. System-browser sign-in returns a
one-minute single-use code bound to an in-memory/session PKCE verifier, never a bearer token.
Host credentials permit relay connection, connection management, and bounded publication
snapshots. They cannot approve new OAuth grants, administer users, or access account deletion.
General agent publishing/unpublishing requires in-app confirmation, even for trusted clients.
Chat preview sharing requires a separate explicit **Make preview public** click in the widget. Browser host credentials live in localStorage. They expire after
90 days of inactivity, and account suspension is checked on use. Each grant selects browser
or desktop, and the relay destinations are separate.

## Chat preview data and public disclosure

Flow preview receipts contain the validated action batch, displayed draft, base revision,
and a random confirmation capability in the local library. They do not contain an Anthropic
key. Creation expires after ten minutes. A hosted MCP client receives the displayed draft
through the authorized relay; its UI receives the draft and capability in `_meta`, while
model-visible results contain status and counts. This limits repeated model context; it does
not make the client or its host blind to the preview.

Confirmation tools are app-only and check the current edit grant, originating connection,
host, capability, and revision. They cannot confirm deletion or general publication requests.
The self-contained sandbox UI loads no remote code and inserts draft content as text.
Preview browsing and confirmation invoke no model.

**Make preview public** uploads the entire displayed draft, including unchanged blocks in an
edit preview, through the bounded publication projection. Instructions, action history, local
metadata, and credentials are excluded. The unlisted `/p/*` and `/embed/*` links are publicly
readable; embeds are read-only with no local-library or confirmation access. Withdrawal blocks
subsequent public reads but cannot recall copies already downloaded. Shared snapshots persist
independently of the creation draft and consume normal publication quotas.

## Public documentation and images

Use a fresh, signed-out browser library and fictional fixtures for documentation. Never capture
the personal desktop library, real publication IDs, pairing codes, OAuth callback URLs,
credential fields, account menus, or client configuration containing secrets. An unlisted link
can expose the snapshot even if no password is visible. Inspect screenshots visually and with
OCR, and scan text changes for secrets. See [the screenshot workflow](screenshots/README.md).
