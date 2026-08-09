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

## Durability and offline behavior

- Autosave writes locally without a Save button. When a Scape is open in more
  than one tab, only one tab holds the write lease; the others are read-only.
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

1. You enter your own Anthropic API key in Settings.
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

## Deployment and repository hygiene

- API keys, Cloudflare tokens, `.env` files, and private user data must never be
  committed to GitHub.
- The deployment workflow requires `CLOUDFLARE_ACCOUNT_ID` and
  `CLOUDFLARE_API_TOKEN` as GitHub Actions secrets. Do not make a workflow
  fallback to source-controlled credentials when either secret is absent.
- Production deployment credentials belong in GitHub Actions secrets or the
  local Wrangler credential store, not in source files. Use a scoped token with
  only the Workers and Pages permissions required for this project.
- The public repository contains only the public proxy URL in `.env.example`.
- Keep Secret Scanning, push protection, and Dependabot enabled on the GitHub
  repository when available.
- Never paste a real API key into a screenshot, issue, pull request, chat log,
  test fixture, or exported documentation image.

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
