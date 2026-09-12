# Changelog

All notable user-visible changes to Precipice are recorded here. This project
does not use formal release numbers yet; entries are grouped by date and commit.

## Unreleased

Changes merged after the latest dated entry should be added here before or with
the change to `main`. Move the entry to a dated section when a release or public
milestone is published.

### Changed

- The composer now lives on the canvas *and* in the Scapi panel, over one shared draft and one
  shared transcript. Whichever surface you send from is where the answer appears; an edit sent
  from the canvas opens no panel, leaving the blocks arriving on the canvas as the result.
  Closing Scapi with `⌘J` (or Escape) hides the panel without stopping work in flight.
- Asking now shows only the controls asking can use — the block-type picker and generation
  instructions are hidden, and web search takes their place. Both apply again in Edit.
- Settings is now sectioned — General (theme, model, API key), AI (generation instructions),
  and Agent (MCP) — with Help and Done always visible, so the dialog no longer runs past the
  bottom of the screen.
- Scapi's activity trail now reads in sequence with the answers instead of being pinned above
  them, and skipped-action details fit the panel instead of overflowing it.

### Fixed

- Desktop library transfer now uses `Precipice-library.json`, which macOS can select reliably.
  The private export name is ignored by Git, and the web and desktop instructions now describe
  the same transfer flow.
- "Jump to latest" no longer sits inside the composer.
- The Ribbon and the composer no longer render twice when the Scapi panel is open.

### Security

- Removed the unused `agents` and `@cloudflare/workers-oauth-provider` dependencies, which
  between them accounted for all seven reported advisories (`fast-uri`, `nanoid`, `qs`).
  Neither was imported anywhere; `pnpm audit --prod` is now clean.

- Scapi now brings Ask and Edit into one panel, preserving drafts across mode switches.
  Proposed edits keep their progress, results, and Undo beside the conversation; edit scope
  names the affected blocks and composer controls wrap in the narrow panel.

- Editor AI defaults to the selected blocks, with matching scope copy and a visible Scapi button.
  Scapi shows its context and a proposal review step before generation. Existing-block AI edits
  preserve the layout; single renames have readable completion summaries.
- New blocks find nearby free space, selected blocks fit beside resized assistant panels, and
  inline text editing requires selecting a block first. “Scape block” is now labelled “Document,”
  and the editor explains that work autosaves to this browser.

- Redesigned Home with adaptive onboarding, a compact creator, visual scape previews, gallery/list
  views, persistent pins, search, filtering, and sorting. Added a Product brief starter.
- Home now exposes PDF and scape exports, publication links, and contextual entry points for
  publishing, Scapi, and local agents. Added focused capability help and accessible action dialogs.
- Creation preserves drafts through API-key setup and failed saves, blocks repeated submissions,
  and verifies persistence before navigation. Home rename/delete respects active editor leases.
- Home page and section headings now use the Geist Pixel display face. The design language
  documents the reservation as applying to the `.mono` treatment rather than the typeface.

- Added a local MCP bridge for Codex and Claude Desktop. A paired, open scape can be read and
  updated through validated Precipice actions; changes are reviewable by default and optionally
  apply immediately as one undoable transaction. The local bridge keeps its short-lived session
  only on the user's machine and never receives an AI-provider key.
- Added the Scape block object type: a long-form Markdown document — headings, tables, fenced
  code — that renders on the canvas and becomes an editable Markdown source field when you click
  a selected block (or press Enter), committing on Escape or deselect. Available everywhere Note,
  Journey, and Wireframe are: the add palette, block rail, AI generation, starters, and export.
- Exports moved from `src/persistence/pdf/**` to `src/export/pdf/**` alongside the new
  `.scape` and viewer download helpers; no user-visible change.
- Added invite-only publishing with Google sign-in, Turnstile verification, administrator-managed
  invitations, 50 retained publication slots, a 100 MiB per-account snapshot cap, and a 20-write
  daily publishing budget.
- Public and embeddable scapes now use an isolated read-only viewer. Its relationship lines render
  from hidden, non-interactive React Flow anchors, so visitors can inspect the flow without being
  able to edit it.

- Note bodies and journey details now support Markdown formatting, while preserving the existing
  portable `.scape` data format.
- PDF export downloads around 113 KB less code. The export is vector-only, so jsPDF's image
  and SVG dependencies are no longer bundled.
- Editing one field of a block now writes only that field, so a future block type can hold
  several fields without an edit to one quietly discarding the others.
- Added an Export menu with portable `.scape` downloads and vector PDF exports. PDFs include a
  first-page scape diagram followed by a readable outline of every block and its relationships.
- Documented current multi-tab, offline, storage-persistence, deployment, and
  sensitive-data behavior in the README and security guidance.
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

- Isolated the public viewer from local scapes, editor state, AI settings, and publication
  credentials; narrowed its CSP and limited Worker requests with separate authentication, public
  read, IP-mutation, and user-mutation counters.
- Hardened publishing sign-in and operations: invitation claims now preserve D1 foreign-key
  integrity, unexpected OAuth failures return safely to the editor, sessions expire after seven
  days, and the final active administrator cannot accidentally delete their account.
- Production deployment now validates every required secret and public build value, runs tests,
  applies D1 migrations, and deploys both Workers before publishing the Pages frontend.

- Replaced the rich-text HTML path with allowlisted Markdown rendering. Raw HTML is rendered as
  text, and links are restricted to safe `http`/`https` destinations.
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

- Publishing now recovers from a server-expired session: signing out always clears the local
  credential, and an unauthorized publish attempt returns to the Google sign-in option instead
  of leaving the Publish sheet stuck in a signed-in state.
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
