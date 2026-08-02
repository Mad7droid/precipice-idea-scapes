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
- The production Anthropic credential is intended to exist only as a secret on
  the Cloudflare Worker. The frontend should call the Worker, not expose the key.
- The Worker restricts browser origins, rejects oversized requests, limits
  requests per IP window, and returns `Cache-Control: no-store` for upstream AI responses.
- The development AI harness is intentionally different: it can accept a local
  API key for testing. Use throwaway development credentials and clear local
  browser data when finished.
- Scapes and settings are currently local browser data, not encrypted cloud data.
  Do not store sensitive personal, customer, or production information in them.
