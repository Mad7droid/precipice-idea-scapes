# Workspace UX implementation record

## 0.1.17 review fixes and release verification

Code review fixes: scapes and Inbox notes have separate backup limits; archived notes can be
deleted after confirmation; Open links to deleted scapes are hidden; malformed Inbox markers
import as ordinary scapes; imports cannot exceed the Inbox limit; scape-name matches are
reported once; the search cache evicts least-recently-used documents; search supports ↑/↓/Enter
with listbox semantics; unsaved captures persist for the tab with Discard; deleting a scape
removes its work state, last-opened time and stored editor session.

Security check: no new network origin, native permission, credential path or `innerHTML`;
`/dev/appearance` is compiled out of production; the CSP test recomputes the changed pre-paint
hash; drafts use session storage only; search excerpts render as text.

Checks run on 9 November 2026: `pnpm verify` (90 files, 980 tests), `pnpm test:mcp` (7),
`cargo test --locked` (49 passed, 3 ignored). Desktop packaging and install are recorded in the
0.1.17 release notes once complete.

## Compact Inbox revision after review

The user rejected the note-edge/footer layout below and explicitly selected compact note cards
in a two-column grid. This supersedes the earlier Inbox appearance. Current source uses compact
cards, a date header, full unmodified note text and small actions. It removes the colored spine,
Note label/icon, shadow and separate footer strip. Add to scape toggles an inline destination
picker; editing, cancel, archive/restore and atomic promotion keep the existing repository paths.
No theme, route, persistence schema, dependency or permission change accompanies this revision.

References inspected on Mobbin: [Craft](https://mobbin.com/screens/402010a7-ea29-4342-ac4b-b6b4dcfe6080)
and [Plane](https://mobbin.com/screens/e918626d-1fd2-472a-a5fd-197da26e55f2) show content cards
in a grid with compact secondary controls. Their colors, imagery and typography were not carried
over. The exact destination disclosure and wording are implementation judgment. A list-oriented
Voicenotes screen was also inspected, but the user selected cards.

Safari confirmed the two-column layout in light and dark modes and destination reveal/collapse.
Screenshots: `.context/visibility-compact-notes-light.png` and
`.context/visibility-compact-notes-dark.png`. The local comparison file
`.context/inbox-before-after.html` embeds both panes; a second note was added during user review,
so the comparison discloses that content-count difference. Targeted tests cover cancel without
a write, archive protection while editing, destination disclosure and failed-promotion source
retention, alongside repository promotion/backup tests. Earlier full-suite results below remain
historical; see the compact Inbox check logs under `.context/compact-inbox-*.log` for this revision.

## Visibility and light-mode follow-up

User screenshots exposed unreadable search query and Inbox text. Reproduced in Safari.
The running Vite/Tailwind process still served a stale `.text-base { color: var(--bg-base) }`
rule after the configuration fix. Restarted the local server and checked its served CSS:
`text-base` now sets font size/line height only. No library data or browser storage was cleared.
Search/capture/Inbox editing additionally specify semantic text, placeholder and selection
colors explicitly; the shared dialog provides a primary-text fallback.

Light selection fills are stronger in all three styles. Selected desktop navigation and Inbox
view buttons add a slim inset accent marker; dark palette values are unchanged. Graphite and
Field light surfaces have clearer page/card/input separation. Template borders are clearer.
Inbox reading width is bounded; Cancel restores saved text without a write, and archive is
disabled while editing. Style root application precedes subscriber updates so diagnostics
read the applied palette.

Inbox notes now use the existing note-color marker as a slim edge, a compact Note/date header,
a separate content area and an action footer with an explicit Destination label. Archive stays
secondary in the header; edit and destination actions no longer compete with the note text.
No title is invented or extracted, and the stored capture text is unchanged. The layout wraps
on narrow screens and uses the same fonts and semantic colors in both modes. The final layout
was visually checked in light and dark mode; screenshots are
`.context/visibility-note-hierarchy-light.png` and `.context/visibility-note-hierarchy-dark.png`.

Verification additions: all six palette/mode combinations check primary and placeholder
contrast on inset fields and primary contrast on text selection. Dialog tests protect explicit
field colors; Inbox cancellation test protects saved text and archive guarding. Safari runtime
checked all three updated light selection palettes, Current light/dark search, Field light/dark
and Graphite dark search, capture/save, Inbox light editing/cancel/reload and dark read view.
Screenshots under `.context/visibility-*.png` use only fictional data in the separate Safari
library. Full regression results below are updated after the final run. This is not a claim
that every screen/provider/native workflow was manually exercised.

9 November 2026. Implemented in the shared web/desktop source; not deployed or installed over
the personal desktop app. The [approved plan](ux-and-design-evolution-plan.md) retains its
research and acceptance criteria. [Workspace contracts](workspace-contracts.md) define storage
and compatibility; [design language](design-language.md) defines current visual rules.

## Implemented

- Permanent Current, Graphite and Field palettes in Settings → General, independent of
  System/Light/Dark. Current remains the default. Existing logo, orange Scapi artwork, fonts,
  semantic status colors and object markers remain intact. All palettes share functionality.
- Returning Home prioritizes Continue working and the existing library; creation remains
  available through New scape. Pins, sorting, gallery/list, templates and publishing remain.
- Durable Inbox capture from Home or the editor, with edit, archive/restore and promotion to
  a new or closed existing scape. Promotion uses normal reducer actions, a writer lease and
  an atomic transaction. Retrying does not duplicate the note or discard the source.
- Optional Active/Parked/Done states and filters without changing document edit timestamps.
- Local authored-content search, delayed and cancellable, with bounded indexing and results.
  Opening a hit focuses the matching object. No model calls or external index.
- Editor panel and selection preferences plus session drafts restored locally. Existing
  viewport recovery, autosave, undo and native quit handling retained.
- Scapi task starters prepare explicit Ask drafts; no automatic generation, spending or edits.
  Decorative assistant effects are disabled on working surfaces.
- Capture uses Cmd/Ctrl+Alt+N, preserving the existing dictation shortcut. Content search uses
  Cmd/Ctrl+Shift+F; editor command palette remains available.
- Fixed a Tailwind color/font-size name collision that made `text-base` inherit the background
  color. A compiled-CSS regression test protects readable body text.

## Compatibility and security

No database version change, new remote service, native permission expansion or credential
storage change. Captures export as ordinary v3 note scapes inside the existing library backup
format: older readers retain the text; current import restores Inbox entries with new IDs.
Backups include archived capture text deliberately. Public viewer and publication projections
remain separate from local preferences and search.

The existing native build initially failed because Rust's deep-link plugin lock was 2.5.0
while the existing JavaScript dependency was 2.6.2. The lock now aligns to 2.6.2 with required
transitive patch updates. No mismatch check was disabled or native API changed.

## Verification and local preview

- Full `pnpm verify`: version consistency, worker TypeScript, app TypeScript, production build
  and Vitest: 90 files, 972 tests passing.
- `pnpm test:mcp`: 7 passing transport tests.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`: 49 passing, 3 intentionally
  ignored tests requiring Keychain/model prerequisites.
- `pnpm desktop:build`: macOS app and DMG packaged with ad hoc signing. No notarization,
  installation or external release performed.
- Safari against a separate localhost library: capture → Inbox → promotion → editor,
  authored-body search → selected object, Scapi draft preparation without credentials,
  Home resume, Active filter and persisted Graphite preference exercised with fictional data.
  Graphite dark Settings screenshot is under `.context/graphite-dark-settings.png`.
- Alternative palette text/action/focus contrast and style allowlisting covered by tests.
  Persistence failure tests cover retained capture text and style save rollback.

Run `pnpm dev --host 127.0.0.1 --port 4173 --strictPort`. Open
<http://127.0.0.1:4173/> for the product, then Settings → General. The actual-component
comparison harness is <http://127.0.0.1:4173/#/dev/appearance> (development only).
[Preview checklist](ux-design-preview.html) covers comparison and workflow acceptance.

## Optimization measurements and remaining acceptance

An isolated original-HEAD production build measured a 185.44 kB gzip main entry and 12.36 kB
gzip CSS. The final changed build measured 191.39 kB main and 13.36 kB CSS: approximately +3.2%
and +8.1%. Shared capture/search UI and the search engine load as separate optional chunks.
These are bundle measurements, not startup or interaction benchmarks.

Search caps per-object extraction, per-document text, cached entries/characters and returned
results; partial indexing is disclosed in the UI. Existing library summary enumeration still
reads stored snapshots. No claim of measured startup, pan/zoom, native memory or p95 improvement
is made. Large-library profiling remains an acceptance task before a performance claim.

Automated tests and shared-code packaging do not replace native runtime acceptance: sign-in,
dictation, cloud publication, quit/reopen and every palette/mode combination still need a final
manual release pass. The personal installed app and its library were left untouched. Multi-day
theme preference and reduced-friction outcomes require the user's trial.

Semantic search, automatic daily summaries and a separate daily dashboard remain conditional;
the implemented resume-first Home supplies the daily entry point without new services or rituals.
No behavior or visual contract should be described as universally regression-free based only
on these checks.
