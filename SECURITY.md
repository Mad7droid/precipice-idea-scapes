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
- The hosted app requires a user-owned Anthropic key in Settings. It is stored
  unencrypted in the browser's local IndexedDB and forwarded through the Worker
  for the request; the Worker stores nothing.
- The Worker holds no Anthropic credential of its own. This is deliberate: its
  only access control is an `Origin` check, which any non-browser client can
  forge, so a server-side key behind it would be spendable by anyone.
- The Worker rejects oversized requests, forwards only an allowlist of headers
  upstream, and returns `Cache-Control: no-store` for upstream AI responses. Its
  per-IP counter is per-isolate and best-effort, not a dependable rate limit.
- The development AI harness is intentionally different: it can accept a local
  API key for testing. Use throwaway development credentials and clear local
  browser data when finished.
- Scapes and settings are currently local browser data, not encrypted cloud data.
  Do not store sensitive personal, customer, or production information in them.
