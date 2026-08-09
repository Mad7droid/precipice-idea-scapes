# Changelog

All notable user-visible changes to Precipice are recorded here. This project
does not use formal release numbers yet; entries are grouped by date and commit.

## Unreleased

Changes merged after the latest dated entry should be added here before or with
the change to `main`. Move the entry to a dated section when a release or public
milestone is published.

### Changed

- Scapes now use a single editable tab. A second tab stays fully readable and can take over
  editing with one click, without overwriting the first tab's latest work.
- Promoted card width to shared object geometry. Existing v1 `.scape` files migrate their
  wireframe widths automatically when opened.
- Generation now requires your own Anthropic API key. The hosted Worker no longer
  falls back to a server-side key, so leaving the field blank prompts for a key
  instead of silently generating on a shared account.
- Refreshed the public README screenshots with the current home, generation,
  canvas, connection, and wireframe-inspector experiences.
- Updated the hosted-app instructions to match the starter-based home flow and
  top-right theme controls.
- Refreshed the README with the current All-in-one home, canvas, inspectors,
  help, command palette, light-theme, and Settings screenshots.
- Added [Security and local data](docs/security-and-local-data.md), documenting
  local Scape storage, Claude/Anthropic API-key handling, AI request boundaries,
  deployment hygiene, and incident response guidance.

### Security

- Removed the Worker's server-side Anthropic credential. Its only gate was an
  `Origin` header, which any non-browser client can forge, leaving the hosted key
  spendable by anyone who found the public endpoint.
- The Worker now builds upstream headers from an allowlist rather than inheriting
  the caller's, so cookies, `Authorization`, and `CF-*` headers are no longer
  relayed to Anthropic.
- Added a Content Security Policy and hardening headers to the Pages deployment,
  with a test that fails if the inline theme script's hash drifts.
- Added `.env`, `.env.*`, and `.wrangler` to `.gitignore`.
- Pinned `undici` past its known advisories.

### Fixed

- Local development now works on any Vite/Conductor port, not only `5173`, so AI requests no
  longer fail with a misleading connection error when another local service occupies that port.
- Added an offline app shell, proactive browser-storage persistence, quota-pressure guidance,
  and bounded action-log retention so local Scapes remain available and durable over time.

## 2026-08-02

### Added

- Refined the workspace shell, canvas controls, filters, and theme presentation.
- Added richer Wireframe grids, sections, element labels, spans, alignment, sizing, and presets.
- Added editable Wireframe and Journey inspector experiences.
- Added Cloudflare Pages and Worker deployment configuration.
- Added the current workspace screenshots and refreshed the public README.
- Replaced cramped wireframe canvas screenshots with expanded light and dark views,
  plus clearer filter, model-selector, and relationship-line control views.
- Added the MIT license, security guidance, and non-developer setup instructions.

### Fixed

- Restored the production Settings API-key field and wired user-owned keys into
  generation instead of deleting them during app startup.
- Replaced invalid model aliases with documented Anthropic API model ids so valid
  user keys can complete generation.

### Security

- Documented the production Worker origin allowlist, request-size limit, rate limit,
  secret handling, local browser persistence, and vulnerability reporting process.
