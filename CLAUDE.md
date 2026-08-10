# Precipice — Agent Working Agreement

Read this fully before writing code. It is the contract that lets four agents work
in parallel without colliding.

---

## What we are building this session

A walking skeleton. Not the product in the spec.

**Done means all eight of these work end to end:**

1. App opens. No account, no backend.
2. User pastes an Anthropic API key into settings.
3. New Scape → prompt: *"Design an onboarding flow for a fintech app."*
4. Objects stream in one at a time, auto-layout, connect.
5. Click a node → edit in the inspector → canvas updates live.
6. Drag a node. `Cmd+Z` undoes the drag. `Cmd+Z` again undoes the whole generation.
7. Refresh the tab. Everything survives.
8. Export `.scape`, import it into a fresh scape.

Three object types only: **Note**, **Journey**, **Wireframe**. Not thirteen.

**Explicitly out of scope:** MCP server, multi-provider, Tauri, SQLite, collaboration,
version history UI, templates, tags, archive, search, rich text editing, Storybook,
Playwright, Turborepo.

---

## Locked architectural decisions

Do not relitigate these. If you think one is wrong, stop and report — do not change it.

| Decision | Rule |
|---|---|
| **Canvas** | React Flow (`@xyflow/react`). Not tldraw. Objects are nodes, relationships are edges. |
| **Single mutation path** | `applyAction` in `src/core/reducer.ts` is the *only* way state changes. A user dragging a node emits `MoveObject`. Typing in the inspector emits `UpdateObject`. No exceptions. |
| **Undo** | `applyAction(state, action) => { state, inverse }`. Inverses computed at apply time and pushed to a stack. Actions carry a `txId`; undo pops a whole transaction. |
| **AI never emits coordinates** | The model emits objects and relationships only. The engine runs Dagre. Any action containing `x`/`y` from a model is a bug. |
| **AI emits per-action tool calls** | Vercel AI SDK `streamText`, one tool per action type, applied progressively as they arrive. This is the product's signature moment — do not batch. |
| **Invalid actions are dropped** | Zod-parse every action. On failure, drop it, increment a counter, surface "N actions skipped". No retry loop in v1. |
| **Persistence** | Debounced full-snapshot per scape (300ms) + a separate append-only action log. Not event-sourced replay on load. |
| **No shared barrel files** | Object plugins self-register via `import.meta.glob`. Nothing writes to a shared `index.ts`. |
| **Single app, not a monorepo** | One Vite app, directory-based modules. Packages get extracted later, not today. |
| **Naming** | `Object` in code. `Artifact` only in user-facing copy. Never mix them in a filename or type. |
| **API keys** | Held in `sessionStorage` only, unencrypted, so the key does not outlive the tab (`src/app/useAppSettings.ts`). The settings UI says so plainly. No security theatre. Real encryption lands with the desktop shell and the OS keychain. |
| **Publication session token** | `localStorage`, 30-day expiry, server-revocable. A *different* risk class from the API key: scoped to publications, revocable, expiring. Bearer header, never a cookie — see `.context/publishing-plan.md`. |

### Stack — and what we cut

**In:** React 19, TypeScript, Vite, Tailwind, `@xyflow/react`, Dagre, Zustand, Zod,
Dexie, Vercel AI SDK, Vitest, pnpm.

**Cut, deliberately:** TanStack Query (no server to query), Turborepo (setup cost, no
payoff yet), Lexical (a textarea is enough in v1), Storybook, Playwright, RTL,
Framer Motion (CSS transitions cover everything we need).

---

## `src/core/` is frozen

After Phase 0 merges, **nobody edits `src/core/`**. Not one line.

If your workstream genuinely needs a core change:
1. Stop.
2. Write the exact change you need into your workspace's `NOTES.md`.
3. Report it. It gets made on `main` and everyone rebases.

Core drift across four worktrees is the single failure mode that kills this session.

`src/core/fixtures.ts` contains a hand-built 12-object sample Scape. Use it. It is why
you are not blocked on the other three workstreams.

---

## File ownership

You own exactly one directory. Do not create or edit files outside it.

| Workstream | Owns | Also owns |
|---|---|---|
| A · Persistence | `src/persistence/**` | `src/routes/dev/persistence.tsx` |
| B · Canvas | `src/canvas/**` | `src/routes/dev/canvas.tsx` |
| C · AI | `src/ai/**` | `src/routes/dev/ai.tsx` |
| D · Objects | `src/objects/**` | `src/routes/dev/objects.tsx` |
| Integrator | `src/app/**`, `src/core/**`, config | everything else |

Cross-boundary imports go through **types and interfaces from `src/core`**, never through
another workstream's implementation. Workstream B imports the `ScapeRepository` *interface*
from core, not Dexie from A.

### Publishing wave 1

Same rule, second set of workstreams. Briefs are in `.context/publishing-plan.md`.

| Workstream | Owns |
|---|---|
| A · Publication Worker | `worker/publish/**`, `wrangler.publish.toml`. Touches no `src/`. |
| B · Viewer | `src/viewer/**`, `src/objects/*/view.ts`, `view.html` |
| C · Markdown | `src/objects/markdown/**`, `src/objects/note/**`, `src/objects/journey/**`, `src/objects/ui.tsx` |
| D · Publish client | `src/publish/**` *except* `contract.ts`, `src/routes/dev/publish.tsx`, `src/app/TopBar.tsx`, `src/app/Home.tsx`, `src/app/App.tsx` |
| Integrator | `src/publish/contract.ts`, `src/core/**`, `public/_headers`, `public/_redirects`, `public/sw.js`, config |

**`src/publish/contract.ts` is frozen on the same terms as `src/core`.** It is the wire
contract all four build against and the Worker's only parser of hostile input. If you need a
change, stop, write it into `NOTES.md`, and let it land on `main`.

B and C both touch `src/objects/`, at different paths: C owns the three existing plugins'
`index.ts` and everything they import, B owns the new `view.ts` beside them. B does not edit
C's files; if a `Node` has to change shape to serve both, that is C's edit, requested.

### Dev harness routes

Every workstream ships a route under `/dev/*` that exercises its work against
`core/fixtures.ts`, standalone, with no dependency on the other three. Build this
**first**, not last. It is how you verify without waiting on anyone.

---

## Design system

Tokens are frozen alongside core. `src/design/tokens.css` is the source of truth.

**Never write a raw hex, px radius, or duration in a component.** Use the CSS variables
or their Tailwind aliases. If a token you need doesn't exist, use the nearest one and note
the gap — don't invent a value.

Full rationale and component specs: `docs/design-language.md`. The short version:

- Warm neutrals, never cool grey. The palette hue is ~35°, not 220°.
- Elevation means **lighter surface** in both light and dark mode. Consistently.
- Borders are always alpha, never solid hex, so they composite over any surface.
- Text is never pure black or pure white. `#1E1B17` and `#EDE9E1`.
- Default UI text size is **13px**. This app runs tighter than most.
- Monospace is reserved for machine truth — object ids, action names, model names,
  timestamps, keybindings. Never for prose. This is a rule, not a preference.
- Motion is quiet: 130–190ms, `--ease-out`, no bounce, no spring in chrome.
  Exactly one spring is allowed, on node entry during generation.
- `prefers-reduced-motion` is respected everywhere. Not optional.

---

## Conventions

- **Formatting:** Prettier defaults, 100 col. No debate.
- **Imports:** absolute from `@/`, configured in `vite.config.ts`.
- **State:** Zustand, one store, slices per concern. No context providers for app state.
- **Errors:** never swallow. Surface through the toast channel in `core/notify.ts`.
- **Tests:** Vitest, colocated `*.test.ts`. Every workstream ships at least the tests
  named in its brief. Run `pnpm test` before you claim done.
- **Commits:** conventional commits, scoped to your workstream (`feat(canvas): ...`).
- **Copy:** sentence case, active voice, no filler. A button that says "Export" produces
  a toast that says "Exported." Empty states say what to do next, not how we feel about it.

---

## Definition of done, per workstream

You are done when:
1. Your `/dev/*` route demonstrates every item in your brief's checklist.
2. `pnpm test` passes.
3. `pnpm build` passes with zero TypeScript errors.
4. You have touched no file outside your owned directory.
5. `NOTES.md` in your worktree lists anything you stubbed, faked, or want to flag.

Then stop. Do not start on someone else's workstream because you finished early —
tell the integrator instead.
