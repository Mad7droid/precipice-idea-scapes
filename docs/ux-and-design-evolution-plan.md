# Precipice UX and design evolution

Status: implemented locally, 9 November 2026; release and multi-day acceptance pending. See [implementation record](ux-implementation-record.md)
for completed checks, runtime evidence and remaining acceptance limits.

## Approved decisions after preview review

These decisions supersede the original visual recommendation below. Preserve the current orange
style as the default. Add permanent Current, Graphite and Field palette selection in Settings,
separate from Light/Dark/System. Preserve the existing logo, app icon, orange Scapi artwork,
Inter and Geist Pixel in every style. Share layout, features and interactions across palettes;
do not turn visual experiments into separate functional variants. Use professional direct copy
and restrained functional motion. No breaking changes without the user's prior approval.
Document contracts, logging and previews, and verify the actual local app before review.

The capture implementation uses independent records in the existing settings table rather than
a new database store/version. Backup represents captures as compatible ordinary note scapes,
so existing library readers can retain all text. Details: [workspace contracts](workspace-contracts.md).
Semantic search and automatic daily summaries remain conditional; no new external services are required.

## Outcome and working assumptions

Make it easy to capture a thought, resume existing work, develop an idea with AI, and retrieve the result later. Give extended thinking sessions a calmer visual environment while retaining Precipice's recognizable canvas, connected objects, Scapi, and reversible generation.

The user reports reduced use because Precipice feels like a hassle, dislikes the prominent orange and current whites, and authorizes reconsidering the design language when it improves the product. Their approval covers planning here. Actual personal usage, dominant tasks, and session timings have not been measured. Recommendations are hypotheses to validate, not evidence of improved retention or productivity.

Start with this assumed loop: capture an unstructured idea, develop it in a scape, return later, retrieve or share a useful result. Do not require daily organization, a task-management ritual, AI setup, or a new taxonomy to use the app.

## Evidence and current constraints

Source reviewed: `src/app/Home.tsx`, `home/CreationPanel.tsx`, `home/Sidebar.tsx`, `home/library.ts`, `home/LibraryControls.tsx`, `home/ScapeCard.tsx`, `Editor.tsx`, `TopBar.tsx`, `editor/useEditorSession.ts`, `editor/useEditorShortcuts.ts`, `editor/layout.ts`, `src/ai/scapi/suggestions.ts`, `src/design/tokens.css`, `docs/design-language.md`, `docs/library.md`, `CLAUDE.md`, and the documented storage and native permission boundaries.

- Home places the creation composer and templates before the existing library. The same arrangement serves returning users.
- Library search matches names only. Pins, gallery/list mode, publication filtering, and sorting already exist and must survive.
- Home clears `lastScapeId` when mounted. A reliable resume item needs a distinct last-opened record or a deliberate change to this behavior; otherwise visiting Home destroys the resume source. Opening and editing must remain different signals.
- The editor already protects autosave with a single-writer lease and flushes on native quit. It also has viewport visibility recovery, an existing command palette, shared AI drafts across composers, and contextual Scapi questions. Extend these mechanisms before introducing alternatives.
- Theme tokens bind vivid orange to selection, focus, active edges, and risk. A palette migration must separate these roles. The design guide also contains historical statements that differ from current tokens, including dark primary-action values; implementation is the baseline.
- Browser and desktop libraries are separate. This plan does not introduce synchronization or imply cross-device continuity.
- The token file is marked frozen and contributor instructions require semantic tokens. The user explicitly permits core design evolution; implement a deliberate, documented token revision rather than component overrides.

### Mobbin references inspected

These are web screenshots, useful for the shared web/native UI. They do not establish native keyboard behavior, accessibility, security, performance, or user outcomes.

| Reference                                                                                    | Visible decision                                                                       | Application to Precipice                                                | Do not carry over                                          |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| [Linear project overview](https://mobbin.com/screens/fed68772-ccc3-48be-8c28-3691a441728b)   | Neutral navigation, readable document body, contextual properties at the side          | Content has the largest uninterrupted area; properties remain secondary | Its white palette, project-management fields, or tiny text |
| [Linear initiative](https://mobbin.com/screens/fbe66735-93b3-495b-b071-923d3d5e1bad)         | Latest update appears above the longer description                                     | A concise last-session cue before opening a scape                       | Progress charts and team reporting                         |
| [Miro canvas with Sidekick](https://mobbin.com/screens/88d472be-d2ce-4cf1-ad91-71dbd1854a2d) | AI transcript beside the board, contextual selection cue, visible add/discard controls | Keep canvas context visible while answering or reviewing changes        | Its large toolbar or specific accent                       |
| [Fibery Home, dark](https://mobbin.com/screens/c44104a5-ebfd-4527-853a-7afc06c34962)         | My Work, search, recent items, and distinct charcoal surfaces                          | Resume/search take priority over a large generation prompt              | Configurable dashboard widgets or its dense nested sidebar |
| [Rox Home, dark](https://mobbin.com/screens/ac3c5128-08d9-485f-b264-c034728c61c8)            | Dark surfaces separated by tone and restrained borders                                 | Compare charcoal elevation and restrained accent coverage               | CRM workflows or an empty dashboard scaffold               |

Linear is a structural reference, not evidence for a dark theme. Fibery and Rox provide examples from other domains for surface treatment only. Things and Milanote were not found in the requested web searches; do not attribute the returned screens to them. Miro was returned in the board-editor search and inspected directly.

### Additional research

- [NN/g: recognition and recall](https://www.nngroup.com/articles/recognition-and-recall/): use visible recent items and content previews as retrieval cues. This supports the proposed resume workflow, not a claimed result for Precipice.
- [NN/g: progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/): expose secondary capabilities without placing every setting in the primary working area. Preserve discoverable menu and search routes.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/): target AA for applicable web UI, including text/non-text contrast, keyboard access, focus not obscured, dragging alternatives, and minimum target size. A clearly visible two-pixel focus outline is an additional design target; the detailed Focus Appearance criterion is AAA, not AA.

## Visual direction

Recommended direction: graphite surfaces, low-chroma mineral colour, readable content, and compact controls with room to operate them. This is a design proposal based on the user's preferences; exact colours require rendered comparison and contrast measurement.

Prototype two treatments of the same real Home and editor states before migrating tokens: graphite with a restrained blue-green interaction accent, and stone grey with an ink-blue interaction accent. Recommend graphite as the first candidate. Include both a dark and a softened light theme in the chosen system. Preserve the saved System/Light/Dark preference and avoid forcing existing users into dark mode.

| Element            | Proposed rule                                                                                                         | Acceptance condition                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Dark surfaces      | Graphite rather than brown-black; distinct canvas, base, panel, and raised levels                                     | Selected, inactive, disabled, and read-only states remain distinguishable at normal brightness |
| Light surfaces     | Soft stone-grey working background; brighter surfaces reserved for content and raised controls                        | Avoid broad stark-white panels; retain sufficient text and boundary contrast                   |
| Interaction colour | Small blue-green or ink-blue cues; neutral primary fills where contrast permits                                       | Focus, selection, links, and primary action have documented semantic roles                     |
| Orange             | Retire from routine chrome; retain only if a small brand detail earns its place in comparison                         | No dependency on orange for risk, warning, selection, or generation meaning                    |
| Type               | Keep Inter; standard sans headings for working surfaces; evaluate pixel type only for wordmark/short identity moments | Content reads at comfortable sizes and browser zoom; no 11px essential action labels           |
| Structure          | Alignment, spacing and surface tone distinguish areas; fewer nested card borders and pill controls                    | The main task remains apparent in populated, empty, and error states                           |
| Identity           | Connected-map thumbnail, useful object colour, restrained Scapi presence, clear reversible generation feedback        | Recognizable at Home and inside a scape without oversized mascots or ornamental content        |
| Motion             | Short state feedback; reduced-motion equivalent; keep streaming readable without repeated viewport movement           | No layout jumps, pulsing idle AI decoration, or animation required to understand state         |

Avoid a new font dependency, decorative gradients, glass panels, excessive rounded cards, generic motivational greetings, glowing AI buttons, dashboard widgets without a job, and a blanket reduction in contrast to make the app feel softer. Do not copy a reference application's branding. This is a product-specific judgment, not a claim about what every reference does.

Use semantic tokens throughout, including React Flow nodes/edges, menus, dialogs, selection marquees, focus rings, Scapi, agent review, connection states, published views, loading/error states, and print/PDF surfaces. Preserve object type and user marker meaning. Do not recolour user-created wireframe content or stored object data merely to restyle the shell. Audit hard-coded values and explicit light surfaces. Keep theme selectors scoped to `:root` so React Flow's own theme classes cannot override the document.

## Ordered implementation

Deliver small, independently reviewable changes. Each phase needs its UX, performance, security, and compatibility acceptance evidence before release.

### 0. Establish the baseline and compare the visual direction

Deliverables:

- Inventory every reachable action, route, keyboard shortcut, persistence boundary, publication state, provider connection, and agent review operation.
- Capture fictional-data Home and editor fixtures: empty, returning-user, large library, large canvas, selected block, AI streaming, read-only follower, error, publish/manage, and settings states. Use isolated stores; follow screenshot provenance rules.
- Record current cold/warm startup, Home-to-scape time, canvas interaction latency, search time, save latency, main bundle size, memory, and retained listeners on representative browser and native hardware.
- Render the two colour treatments against the same fixtures. Select on legibility, comfort, recognizable identity, and control clarity. Record the resulting token decision before shared-component migration.
- Record browser/device targets from current release support; explicitly include Chrome, Safari/WebKit, macOS WKWebView, and narrow web layouts in verification. Do not claim support without testing it.

Exit: preserved-function checklist, baseline measurements, and selected visual specimen. No production palette change from a swatch alone.

### 1. Migrate the design foundation

Scope: `tokens.css`, design components, theme initialization, shared shell, canvas chrome, and design documentation.

- Preserve existing semantic token names where their meanings hold. Add new roles only for distinct behavior, such as separating interaction focus from risk.
- Migrate colour, type usage, density, border/elevation and button hierarchy in controlled batches; update the design guide to match.
- Preserve every control's handler, accessible label, focus order, keyboard behavior, disabled state, error feedback, and busy state. Moving a control is not permission to remove its capability.
- Keep System/Light/Dark values compatible. Verify startup and native title-bar appearance without a wrong-theme flash.
- Keep the framework, object renderer, provider interfaces, native IPC, publication contracts, and action protocol intact.

Exit: contrast measurements and screenshot review for both themes; keyboard and zoom review; no meaningful bundle/startup regression against phase 0. Exact performance tolerances must be written after measurements, before implementation.

### 2. Make returning to work the Home priority

Scope: Home, CreationPanel, library controls/cards, routes, local settings, existing command palette.

- Returning-user order: Continue last opened scape, pinned/active work, recent work, compact capture/create entry, full library. Show a scape once where practical; do not build several repetitive shelves.
- First-use Home keeps straightforward manual creation and generation; no empty dashboard modules.
- Store last-opened time separately from document edit time. Opening, pinning, viewing, or changing a workspace filter must not mark content as edited.
- Resume opens the saved scape using existing routes and session boot; missing/deleted scapes fall back to recent work.
- Preserve search, filters, sort and gallery/list preferences. Prefer the existing list view for the proposed compact working area; do not silently overwrite a saved gallery preference.
- Introduce navigation destinations only as their features ship. Keep Templates, Published, Agents, Instructions, Import, Backup, Settings, and Help discoverable through named menus/pages and commands. Provide route compatibility for existing links.
- Give editor and Home a shared open-scape/search entry through the existing command system; preserve current Cmd/Ctrl+K and Cmd/Ctrl+J behavior.

Exit: resume in one activation; returning user can open recent work without passing a creation form; every baseline action still reachable by pointer and keyboard; offline and no-AI use verified.

### 3. Capture thoughts without organizing first

Scope: shared capture surface, Inbox, repository API, narrowly scoped additive data changes.

- In-app capture is available from Home, editor, and command palette. Choose an unused app-scoped shortcut after auditing browser/native collisions. An OS-global shortcut is a later optional native feature with separate scope.
- Capture accepts plain text without template choice, AI setup, title, tags, status, or destination. Persist successfully before clearing the input or saying Saved. Keep the draft and offer retry on failure.
- Store Inbox items separately from normal scapes through a repository abstraction; do not create one hidden giant scape that becomes a writer-contention hotspot.
- Let the user open/edit an item, turn it into a new scape, or append a note to an existing scape. Destination changes use validated actions and its writer lease. Delete/archive the source only after destination persistence is confirmed; retain recovery and prevent duplicate promotion after retry/crash.
- Serialize database schema ownership. Any new store requires one version allocation, old-database upgrade fixtures, and failure handling. Do not let parallel branches independently choose the same Dexie version.
- Capture is local by default. AI processing happens only on a deliberate request. Bound input size and storage growth; render all captured text as untrusted content.

Exit: one action to open capture; no required organization fields; offline save, quota failure, cancel/reopen, navigation, native quit, concurrent promotion, and interrupted promotion preserve text. Portable handling of Inbox items must be defined before general release; never advertise a full backup while silently excluding them.

### 4. Add lightweight work state and reliable session return

- Use Active, Parked, Done for scapes; Inbox is a capture destination, not a compulsory scape status. Existing scapes remain visible and unclassified unless the user changes them. Pins remain independent.
- First ship work state as local metadata through settings/repository APIs without changing document contents, action history, or public snapshots. Clearly document that local organization does not transfer until a versioned portable-metadata format is designed.
- Persist per-scape viewport, valid selection, panel visibility/width, and unsent draft using existing mechanisms where available. Read the full session implementation before adding duplicate persistence.
- Validate restored values and clamp for the current window. If saved content is off-screen, use the existing viewport recovery. Deleted selections must not break opening.
- Preserve local AI conversation according to existing storage semantics; audit where it currently lives before extending retention. Do not silently add persistence of sensitive prompts. Keep unsent drafts out of public projections, exports and telemetry by default.
- Never automatically re-send a prompt or re-run a tool after restoring a session. Hide/show of Scapi must not cancel work; actual cancellation remains explicit.

Exit: old libraries open with every scape reachable; status changes preserve edit timestamps; restart/resize/duplicate-tab/failed-save cases do not overwrite newer work or replay AI actions.

### 5. Put useful AI actions beside the current work

Scope: existing Scapi suggestions, Ask/Edit routing, applier, and generation UI.

- Extend contextual suggestions rather than introducing another assistant or parallel prompt state. Initial actions: Summarize, Identify open questions, Extract decisions, Suggest next steps, and Turn selection into a plan.
- Show only a few relevant suggestions for the current selection/content. Keep free-form Ask/Edit, provider/model choices, manual editing, and all current generation capabilities available.
- Make scope visible: selection or this scape. Cross-scape access requires a separate explicit scope choice and preview of what will be sent.
- Summaries and suggestions are answers until the user asks to apply them. Mutating results use existing validation and transactions, preserving streaming cancellation and undo. Broad cleanup/layout rewrites get a reviewable proposal with counts and scope.
- Plain-language generation progress can be primary; detailed action protocol remains expandable. Keep transaction undo and visible error recovery.
- No background generation on app open, no silent model upgrade or retry that multiplies cost, no automatic publication, and no expansion of agent access. Imported notes and tool results are untrusted data, never authority to override scopes or application instructions.

Exit: text-only replies do not mutate documents; failed/cancelled streams do not leave misleading success states; applied edits remain validated and reversible under the existing transaction contract; no context or credential leakage.

### 6. Search content and open the precise result

- Ship local lexical content search before semantic search: names, supported text fields, object type, user tags, and explicit decisions where represented. Read content via repository APIs, not UI code reading Dexie directly.
- Results show a bounded excerpt and scape/object location, then open and focus the matched object. Escape returns focus and clears/dismisses predictably. Keep manual filters and current sort behaviors available.
- Use a rebuildable local index with document revisions, incremental invalidation, cancellation, bounded result counts, and worker execution when profiling warrants it. Never load/render every document per keystroke.
- Treat query/excerpts as untrusted text. Delete/rename/import/edit invalidate the index. Remove indexed content when its source is deleted. Filter unsupported or unreadable versions and report partial indexing without hiding working results.
- Semantic retrieval is a later experiment only if lexical retrieval fails representative queries. Decide on local embeddings, model size/download, index privacy, provider costs, and opt-in disclosure before implementation. Do not upload the library as a side effect of search.

Exit: representative text is findable without remembering titles; result navigation works in browser and native; stale/deleted objects do not crash; offline results work; large-library latency stays within the measured budget.

### 7. Add a small daily landing only if it earns the space

- Reuse Continue, Active, recent work, and Inbox from previous phases. Avoid creating a second Home/dashboard system.
- An optional last-session cue should be derived from reliable local activity first. Distinguish last edited, last opened, and last generated.
- Defer AI-generated catch-up summaries, automatic prioritization, notifications, and scheduled digests until usage demonstrates a need and retention/cost choices are explicit.

Exit: user can resume or capture immediately; no required daily review and no routine background network work.

## Cross-cutting stability and security rules

1. All document changes pass through the existing validated action reducer and repository boundaries. Preserve IDs, object/relationship integrity, transaction undo/redo, supported schema versions, and portable import semantics.
2. Keep browser and desktop stores separate. Imports create new IDs; do not overwrite existing libraries. Do not promise live cross-device resume.
3. Preserve writer leases, read-only followers, takeover ordering, save sequencing, autosave flush, and native quit protections. New capture/promotion paths need the same protection.
4. UI metadata stays outside document edit history unless it is intentionally document content. Document changes must not be performed just to update Home summaries.
5. Browser keys remain tab-session data; desktop secrets remain in Keychain behind restricted commands. Never put secrets into drafts, search indexes, analytics, logs, screenshots, snapshots, exports, or markdown plans.
6. Keep native capabilities narrow and limited to trusted local windows. No new filesystem/network/OS permissions for a visual migration. Preserve URL and deep-link validation, CSP, markdown sanitization, safe external links, OAuth state, and provider boundaries.
7. Publishing stays a separate explicit disclosure of a bounded read-only projection. UI restyling must preserve draft/published/stale/withdrawn distinctions, update/unpublish/delete semantics, ownership checks and URL construction. New Inbox, local metadata, drafts, or indexes are excluded unless a reviewed publication contract explicitly includes them.
8. Preserve agent scopes, host and connection checks, review policy, revision checks, consent, revocation, idempotency, and app-only confirmation tools. A contextual AI button is not permission for an external agent to gain more access.
9. Keep generated/remote content distinct from UI controls and permissions. Search snippets and imported content cannot execute HTML or trigger tool operations.
10. Preserve dictation, voice/routing, accessibility, provider selection, connection recovery, model availability handling, imports, PDF/.scape exports, backups, and public previews. Every relocated feature gets a replacement route and a smoke check.

## Performance and privacy budgets

Before phase 1, record repeatable baseline measurements on the same hardware, data, build mode, and runtime. Set per-phase numerical tolerances from those measurements. Do not assert a universal millisecond budget or claim optimization without measurements.

- Home renders bounded summaries and lazy thumbnails; opening Home must not parse the full library.
- UI theme changes use CSS tokens and avoid JS animation/render loops. Preserve lazy loading of optional AI markdown/panels.
- Search indexes incrementally; captures acknowledge durable saves; session metadata writes are bounded and batched without delaying content durability.
- Measure canvas pan/zoom/selection, streaming updates, and memory after repeated navigation. Optimize only where profiling demonstrates a problem.
- Prefer a local, optional diagnostics view for time-to-resume, capture failures, search latency, AI error/cancel rate, and startup. No remote analytics added by default. Never record note text, prompts, raw searches, titles, credentials, or shared URLs. If remote telemetry is later needed, define consent, payload, retention, and deletion first.

## Release gates and rollback

| Area              | Required acceptance evidence                                                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UX/accessibility  | Both themes; keyboard-only complete journeys; clear focus; accessible names/status; screen-reader spot checks; zoom; reduced motion; empty/loading/error/read-only states; drag alternatives and target sizing |
| Persistence       | Existing database upgrade fixtures; save failure/quota; last-edit flush; duplicate tabs and takeover; import-as-copy; unsupported versions; backup/restore; capture promotion recovery                         |
| AI and agents     | Available provider combinations; missing/offline/expired credentials; streaming, retry, cancel, Ask/Edit and scope; undo; agent review, denial, stale revisions, revocation and idempotency                    |
| Publishing/export | Publish/update/unpublish and stale state; authentication return; local/export/public content boundaries; desktop-generated hosted URLs; .scape and PDF output; destructive-action protections                  |
| Web               | Current supported browser matrix including Safari; touch/narrow layouts, keyboard, reload/navigation, offline, local library isolation and service-worker update behavior                                      |
| macOS             | Native build and launch; WKWebView rendering, window resize, theme startup, Keychain, provider auth/deep links, clipboard/file import/export, quit flush, dictation and local MCP                              |
| Performance       | Compare repeatable cold/warm, library/canvas/search/save timings, bundle and memory measurements with baseline and the agreed numerical tolerance                                                              |

Use existing focused tests for touched behavior. Before integrated release run `pnpm verify` and `pnpm test:mcp`; for native-impacting work also run `cargo test --manifest-path src-tauri/Cargo.toml` and `pnpm desktop:build`. A JS test suite or packaged build alone is not native acceptance. Capture test results, manual runtime evidence and known limitations per release. This planning change itself does not run or claim those checks.

Stop release for data loss, changed permissions/disclosure, broken save/undo/lease behavior, unreachable existing capabilities, failed critical keyboard paths, or an unexplained performance regression beyond the agreed budget. Fix or revert the smallest responsible batch before proceeding.

Make visual and navigation changes reversible independently of data changes. Local development toggles may aid comparison; remove them when settled instead of adding a remote flag service. Additive database changes must remain safe if UI code is reverted; do not downgrade IndexedDB schema versions. A prior binary may reject a newer database, so rollback may require a forward-compatible patch rather than reinstalling an older app. Validate that path before releasing a schema change. Backups contain sensitive content and do not currently include action history or all local metadata; do not claim otherwise.

## Suggested change sequence

1. Baseline fixtures, preserved-function inventory, performance measurements, and visual comparison.
2. Token/component migration with refreshed design documentation.
3. Resume-first Home and shared scape navigation.
4. Inbox persistence, recovery and portable-data design, then capture UI and promotion.
5. Work state and session recovery improvements.
6. Contextual Scapi actions and legible review/progress.
7. Local content index, results UI, and precise navigation.
8. Integrated web/native acceptance and measured daily-landing experiment.

Schema, core types, tokens and shared components each need a single owner when work happens in parallel. Feature work can proceed in parallel only after these contracts are agreed. Keep each change deployable and reviewable without bundling auth, provider, native transport, or publication rewrites into the visual work.

The first implementation milestone is the measured baseline plus rendered Home/editor colour comparisons. The first usable release combines the selected visual foundation and resume-first Home. Capture follows once its durable-save, recovery, and backup behavior is ready. Full semantic retrieval and automatic daily summaries remain conditional experiments.
