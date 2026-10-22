# Changelog

All notable user-visible changes to Precipice are recorded here. This project
does not use formal release numbers yet; entries are grouped by date and commit.

## 2026-10-22 — 0.1.14

### Added

- "Use Jev only" in Settings → AI. Jev routes alone with up to 4 s to answer and no on-device
  fallback. When Jev cannot answer, the reason is shown, such as a rejected key or no answer
  in time, and live voice does not run that phrase.

### Changed

- Live voice understands speech better. Softened requests like "can you just simplify this?"
  route as edits, both on-device and in Jev's rubric. Edits are told to change or remove what
  exists when asked to simplify, shorten, merge or clean up, instead of adding objects. Spoken
  requests reach the model marked as speech, with the last three phrases and what the previous
  run changed, so "it" and "that" keep their meaning. Spoken questions get short answers.

## 2026-10-22 — 0.1.13

### Fixed

- Jev routing in the Mac app. TypeSafe's CORS policy rejected the app's origin, so every
  request failed and routing fell back to on-device. The app now calls Jev from its native
  process, with the key read straight from Keychain.
- Live voice no longer splits one sentence into two requests when you pause mid-thought.
  Words heard within 0.6 s of a phrase join it before it runs.
- Scapi answers above the canvas render markdown and object links like the Scapi panel,
  instead of showing raw `**` and backticks.
- Live voice and AI progress take far less of the screen. While live, the composer keeps its
  height: one line shows what you are saying or the latest phrase with its timings, the Live
  button becomes Stop with a timer, and earlier phrases open from a small "runs" control as
  an overlay. The progress strip is one row while working, with every step one click away.
  Answers above the canvas are capped lower. A live run that errors is shown as failed.
- The composer's Send button no longer wraps onto a second line next to Live. The fallback
  label now says Jev didn't answer, rather than claiming a timeout.

## 2026-10-22 — 0.1.12

### Added

- Live voice in the Scapi panel: press Live and talk. Each pause runs what you said as an Ask, Edit, Connect or local command, with no Send. Each
  phrase shows who routed it (Jev or on-device), which model ran it, and how long routing
  and the run took. On the web, words also appear while you speak. Every edit stays one-step
  undoable.
- Dictation in the web app, using the browser's on-device speech recognition (current Chrome
  and Edge). Audio stays on the device; no cloud recogniser is used.

### Changed

- The routing pill names its decider: `Jev`, a Jev-in-progress indicator, `auto` for
  on-device, or `local` when Jev did not answer in time.
- Generation and Scapi answers name the provider and model doing the work, such as
  `Claude · Sonnet 5` or `ChatGPT · gpt-5`.
- Web dictation keeps listening across pauses until you stop it.

## 2026-10-22 — 0.1.11

### Added

- Local developer preview: Continue with ChatGPT in Settings → AI uses an eligible ChatGPT
  plan for creation, Ask, Edit, Connect and Deepen without an Anthropic API key. Runs only on
  `pnpm dev` at 127.0.0.1; hosted and Mac app sign-in are not available yet. Anthropic API
  keys remain under Other ways to connect, and billing connections never switch automatically.
- Optional draft routing in Settings → AI: local suggestions for Ask/Edit, scope, object
  types and a fast model tier, with per-draft manual overrides. Experimental Jev enhancement
  uses a separate TypeSafe key and falls back locally after 800 ms. Both switches default off.
- Confirmed local command chips for undo, redo, focus, fit, select-all and connecting the
  selection. Deepen with Opus runs a separate undoable pass on generated objects.

- Dictation in the Mac app: a mic beside Send in the canvas composer and the Scapi panel.
  Click to talk, click to stop, Esc to cancel pending audio and keep inserted text. Text
  appears phrase by phrase in the draft and is never sent on its own. Speech is transcribed on the Mac by Whisper; audio is never
  saved or sent. English and Hindi, with experimental Malayalam, chosen in Settings → General.
  The first use offers a one-time speech model download from Precipice.

### Changed

- Microphone level updates now render only the meter, keeping the composer stable while listening.
- Jev draft requests use a separate proxy rate budget from generation.
- Dictation now has explicit starting/listening/finishing feedback and a visible cancel
  control. Cmd/Ctrl+Shift+Space toggles it from the focused composer. Send waits for dictation
  to finish; cancelling keeps inserted text and ignores late phrases. Setup and errors have
  keyboard dismissal and recovery actions. The voice meter uses transforms and stays static
  under reduced motion. Competing composers cannot claim a session during startup.

## 2026-10-21 — 0.1.10

### Changed

- Lower memory use over long sessions. Undo keeps the most recent 200 steps per open scape
  instead of every edit since it was opened. Agent history and revert cover the last 30 days;
  older receipts are removed at launch, except previews that are still publicly shared. Edit
  history trims itself even when a scape only sees short sessions. The editor no longer
  re-hashes unpublished scapes on every edit, and Scapi keeps only the conversation it sends.

## 2026-10-11 — 0.1.9

### Changed

- Scapi stays beneath the latest chat answer after it finishes, with occasional random smiles,
  winks and glances. Click reactions remain available while idle; automatic reactions pause
  while working, offscreen, in hidden windows and under reduced motion.
- The header's Ask Scapi button uses only the avatar, with its tooltip and accessible name.
- Ask/Edit send buttons replace the arrow with Scapi on a cream disc that separates the
  orange mascot from the action fill in either theme. The mode switcher is unchanged.

## 2026-10-11 — 0.1.8

### Fixed

- Scapi now identifies Anthropic's monthly API usage cap, including its reset timestamp,
  instead of showing a generic HTTP 400 failure. This is distinct from missing credits and
  transient rate limits. Account limits must be changed in Anthropic Console.
- Scapi suppresses the SDK's default raw-error console logger; failures still reach the
  transcript through the existing safe error handling.

## 2026-10-11 — 0.1.7

### Fixed

- Scapi uses basic web search to avoid implicit code-execution transcript records. Search
  fallback and malformed-history recovery recognize streamed provider errors, keep retry
  limits, and never append a restarted answer after partial output.
- Scapi explains billing, permission, request-size and server failures with safe actionable
  messages; unknown provider failures include a safe status/type reference.

### Added

- Click Scapi on the home page or in an empty Scapi chat for a wink, a smile, a confetti burst
  or a look around. Reactions play only while Scapi is idle and never show the warning face.

### Changed

- After a failed Scapi request, the mascot shows concern briefly and then steps aside. The
  error card and retry stay in place.
- MCP agents are now told to call `preview_flow` whenever you ask to see, show or preview a
  flow, journey or wireframes, so the in-chat preview appears without naming the tool.

## 2026-10-11 — 0.1.6

Released to the hosted app, MCP connector, and local Mac installation. See the
[release record](docs/releases/0.1.6.md) for verification and client acceptance status.

### Added

- Scapi now has a face. The mascot sits above the home title and greets you in an empty Scapi
  chat; a small avatar marks the Scapi header button and panel header. While Scapi works, a live
  mascot at the end of the chat thinks, reacts once when an answer completes and shows concern
  on a real failure; canvas answers show the same states. Motion pauses offscreen and respects
  reduced-motion settings.
- MCP flow previews have an **Expand preview** button that asks the chat host for fullscreen.

### Changed

- The MCP flow preview map scales to fit a responsive viewport instead of a fixed-size
  scrolling area, so the whole flow is visible at once.

### Fixed

- MCP flow previews keep their preview metadata in tool results, so supporting hosts render
  the preview viewport instead of an empty frame.

## 2026-10-10 — 0.1.5

Released to the hosted app, MCP connector, and local Mac installation. See the
[release record](docs/releases/0.1.5.md) for verification and client acceptance status.

### Added

- MCP flow previews: inspect connected flows, journey steps, notes, and wireframe screens
  inside supported Claude and ChatGPT chats before creating them. Confirm or discard the exact
  draft from chat without another model call. Explicitly share a read-only hosted preview and
  copy iframe code before adding the flow to the local library; shared previews can be withdrawn.

- Home: a sidebar (Home, Templates, Published, Agents, Instructions, plus Import, Back up
  library, Settings and Help) and a prompt-first home with one question, one composer and one
  row of templates. Templates explains what each template creates; Published lists live and
  reserved links with copy, view and manage; Agents and Instructions are full pages.
- Library: pinned scapes sort first, filters show counts, list/gallery toggle, `/` to search,
  grouped card menus and template-aware empty thumbnails. "Export library" is now
  "Back up library".
- Templates replace the old starters: Blank, Product concept, User journey, Screen flow and
  Research synthesis. Mind map scapes open as Research synthesis and Product brief scapes as
  Product concept.

### Changed

- A template no longer locks which blocks a scape can hold. Every scape can add notes,
  journeys, wireframes and documents from the palette, shortcuts and composer; the template
  only focuses what AI drafts when no types are picked.

- Model picker: Claude Sonnet 5.5 and Claude Opus 5.5. The default stays Sonnet 5.
- Settings → Agents: hosted OAuth connector with the publishing invite gate, browser/desktop
  library selection, scoped access, revocation, and persistent host connections.
- macOS local MCP: one-click client setup, no ports or Node runtime, and background app launch.
  Remote desktop sign-in uses the system browser, a PKCE callback, and Keychain storage.
- Canvas review cards with per-agent trust, validated atomic batches, one-step undo, operation
  outcomes, and serialized concurrent writes. A deployment-wide daily budget and kill switch
  protect the hosted connector.

### Fixed

- Chat previews disable cancelled drafts and clear withdrawn links when refreshing status.
- macOS bundles explicitly use ad-hoc signing and must pass full signature verification before
  installation or artifact upload. This fixes an unsealed bundle with only a linker-signed executable.
- Mac installation permits idle MCP stdio helpers while protecting a running editor.
- Deployment checks the release version and verifies the live bundle, iframe route policies,
  OAuth metadata, and unavailable public snapshots after deployment.

- Published share links use the hosted Pages viewer even when copied from the Mac app;
  existing publications no longer receive a `tauri://localhost` share address.

- Desktop: Continue with Google now signs in through the system browser; it previously
  showed nothing because Google and Turnstile cannot run inside the app.
- Desktop: agents stay connected when Precipice quits or restarts. Their next request reopens
  the app in the background and resumes the session; Claude Desktop no longer needs a restart.
- Desktop: connected local agents (e.g. Claude) now show a quiet "connected" status on the
  canvas while idle, with product names instead of package names.

### Security

- The hosted connector refuses to sign relay tickets without a configured `TICKET_SECRET`.
- Signing out of publishing on the web also revokes the tab's agent host credential.

### Changed

- Canvas: two-finger scroll pans at full speed, tracking your fingers one-to-one.
- Canvas: zooming is smoother — the canvas no longer re-renders on every frame of a zoom
  gesture, and the camera is saved once a gesture ends. The editor also loads faster: the AI
  and MCP SDKs now load only when they are used, cutting startup JavaScript by about a third.
- Canvas: notes, journeys, and scape blocks widen automatically when their content runs past
  four lines. A width you drag a card to always wins; double-click the grip to return to the
  automatic width.
- Canvas: two-finger trackpad scroll now pans instead of zooming. Pinch and Cmd/Ctrl+scroll
  still zoom.
- Settings → Agents: a connected agent now shows as a clear green status row, and agents that
  report internal names (such as `local-agent-mode-precipice`) appear as their product name.
- Refreshed product, desktop, agent, publishing, architecture, and security documentation;
  separated historical workstream plans from maintained guides and refreshed demo screenshots.

- Buttons are one system again. Every action now comes from a single primitive
  (`src/design/Button.tsx`) with four roles — primary, secondary, ghost, destructive — so
  filled actions no longer appear at three different radii, two durations and two font
  weights depending on which panel they landed in. The orange rules are now enforced in one
  place: the deep rust `--action-primary` fill is the only filled accent and a surface gets
  at most one of it, while the bright signal orange is reserved for focus, selection,
  connectors and small indicators.
- Several controls that were wearing the accent without being the primary action have been
  quieted: Scapi's Stop button matches the canvas composer's neutral stop instead of being a
  second orange fill, and the Ask/Edit toggle uses the same selection treatment as the
  outline and library filters rather than an accent fill.
- The Home rename and delete dialogs now put the weight on the confirm as a fill — crimson
  for delete, the action accent for rename — instead of accent-coloured text that read as a
  link and lost to Cancel.
- Fixed the delete-confirmation pill in the sidebar, which took its label colour from the
  bright accent's token and so rendered near-black text on crimson in dark mode.

- The macOS app now has one version number, taken from `package.json`, and `pnpm verify` fails if
  `src-tauri/Cargo.toml` drifts from it. Two builds can no longer claim to be the same version.
- Every GitHub Action is pinned to a commit SHA rather than a mutable tag, and `main` is
  protected against force pushes and deletion. These workflows carry the deployment
  credentials and a push to `main` publishes production.
- `pnpm desktop:install` builds the Mac app and replaces the copy in `/Applications` directly, then
  deletes the staged bundle under `src-tauri/target` that made a second "Precipice" show up in
  Spotlight. It refuses to replace a running app or anything that is not Precipice.
- The composer now lives on the canvas _and_ in the Scapi panel, over one shared draft and one
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
