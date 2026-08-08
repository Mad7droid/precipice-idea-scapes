# Security Policy

## Supported versions

Precipice is pre-1.0 and under active development. Security fixes are applied
to the latest commit on `main`; older commits and hosted preview deployments
may not receive fixes.

## Reporting a vulnerability

Please do not open a public issue for an undisclosed vulnerability. Use
[GitHub’s private security advisory form](https://github.com/Mad7droid/precipice-idea-scapes/security/advisories/new)
and include:

- the affected URL, commit, or file;
- clear reproduction steps or a minimal proof of concept;
- the security impact and any required access;
- suggested mitigation, if known.

Please allow reasonable time for investigation and a fix before public
disclosure. We will acknowledge valid reports and coordinate disclosure when
appropriate.

## Security notes

- Never commit API keys, Cloudflare tokens, `.env` files, or private user data.
- The hosted app requires a user-owned Anthropic key in Settings. It is held in
  session storage, so it survives reloads but clears when the tab session ends;
  it is forwarded through the Worker for the request, and the Worker stores nothing.
- The Worker holds no Anthropic credential of its own. This is deliberate: its
  only access control is an `Origin` check, which any non-browser client can
  forge, so a server-side key behind it would be spendable by anyone.
- The Worker rejects oversized requests, forwards only an allowlist of headers
  upstream, and returns `Cache-Control: no-store` for upstream AI responses. Its
  per-IP counter is per-isolate and best-effort, not a dependable rate limit.
- Configure a Cloudflare dashboard rate-limiting rule for `POST /v1/messages` on
  the Worker hostname: 60 requests per client IP per 60 seconds, blocked for 60
  seconds. This edge rule is the dependable capacity protection.
- The development AI harness uses the same in-memory key as the main workspace.
  Use throwaway development credentials when testing.
- Scapes and settings are currently local browser data, not encrypted cloud data.
  Do not store sensitive personal, customer, or production information in them.
