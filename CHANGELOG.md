# Changelog

All notable user-visible changes to Precipice are recorded here. This project
does not use formal release numbers yet; entries are grouped by date and commit.

## Unreleased

Changes merged after the latest dated entry should be added here before or with
the change to `main`. Move the entry to a dated section when a release or public
milestone is published.

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

### Security

- Documented the production Worker origin allowlist, request-size limit, rate limit,
  secret handling, local browser persistence, and vulnerability reporting process.
