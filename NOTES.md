# Notes

Deviations and gaps worth flagging, not blockers.

---

## Product shape pass — home page, outline, connections

### `src/core` was opened, deliberately and narrowly

`CLAUDE.md` freezes `src/core`. It was unfrozen for this pass with explicit approval, for two
changes and no others:

1. **`Scape.meta?: ScapeMeta`** (`types.ts`, plus a permissive `meta` record in
   `serialize.ts`). A scape has to record which starter made it, because the starter decides
   the layout mode, the object types a generation may create, and whether relationships are
   drawn. It lives on the document rather than in browser settings because it must survive an
   export — a mind map that re-imports as a left-to-right flow chart is not the same document.
   The field is an open record, and `toPlainScape` parses through it, so a key written by a
   newer build survives a save here instead of being silently dropped.
2. **`SETTING_KEYS.generateTypes`** — previously the literal `"ui.generateTypes"` written from
   the app shell. Flagged in this file already; folded in while core was open.

`ScapeRepository.create` gained an optional `meta` argument, and `ScapeSummary` gained
`relationshipCount`, `typeCounts`, `starter` and `preview`. Both implementations and the
conformance suite were updated together.

**Not** done, though it was on the table: making `UpdateObject.patch.data` merge rather than
replace. Its inverse is only total because the patch replaces — a merge whose inverse is a
full-data replace cannot remove a key the merge added. Doing it properly means a separate
`MergeObjectData` action with its own inverse, which is real surface area for a bug class
nobody is currently hitting. Still open, still worth doing before core grows further.

### Starters are recipes, not object types

`src/starters/` is a leaf data module (no JSX, no React) describing four starters: Blank,
Journey map, Mind map, Screens. A starter binds allowed object types, a layout mode, an edge
mode, a prompt hint, a placeholder and an optional seed object.

"Mind map" is notes plus relationships plus a radial layout — deliberately *not* a fourth
object type. The three-object-type rule is intact. `LayoutMode` and `EdgeMode` are defined
here rather than in the canvas, because both are properties of the kind of document you are
making; the dependency runs canvas → starters → core, never the other way.

### Three bugs found while building, all pre-existing

1. **The relationship graph was invisible by default.** `readEdgeMode()` fell back to `"none"`,
   so every scape opened with its edges hidden behind a menu. Now the starter supplies the
   default and the override is remembered per scape, not globally.
2. **`DisconnectObjects` was unreachable from the UI.** It has been in the action protocol
   since the beginning and only the model could emit it — a user could draw an edge and then
   had no way to label, reverse or remove it. Selecting an edge now opens a relationship
   inspector. Relabelling and reversing are a disconnect and a reconnect on the *same
   relationship id*, in one transaction; there is no `UpdateRelationship` action and there does
   not need to be.
3. **The composer's scope pill did nothing.** `scope` was held in the shell, rendered, and
   never passed to the generation — `useGeneration` always sent the selection into the
   projection, so "Whole scape" and "Selection" produced identical prompts. Now threaded
   through `userPrompt`, which drops the selection entirely when the scope is the whole scape.
   The home page renders neither pill: there is no selection to scope to and the starter cards
   below already decide the types, and a control that cannot change anything is worse than no
   control.

### Two fixes that came out of driving it in a browser

- **The resize grip was swallowing the source handle.** Both sit on the card's right edge; the
  grip is a full-height 8px strip at `z-10` and the handle is centred on the same edge, so a
  connection drag that started a pixel too far left silently resized the card. The handle is
  now `z-20`.
- **`MIN_ZOOM` was 0.25**, which is too far in to frame a 22-object scape at all — "fit view"
  would stop at the limit and leave half the canvas off-screen, reading as a broken button.
  Now 0.1.

### Radial layout is deliberately bad at chains

`radialPositions` assigns angles first and radii second, so each ring can be sized from the
real projected extent of the cards on it (a 380px wireframe pointing right needs 190px of
radial clearance; the same card pointing up needs half its height). Sizing rings by height
alone overlaps wide cards — the unit test catches this — and by `max(width, height)` produces
rings thousands of pixels across.

A **chain** graph still produces an enormous circle, because every node at depth *d* sits at
its parent's angle and must clear it radially. That is inherent to radial layout and correct;
mind maps branch rather than chain, and Tidy is a manual override. Nothing is broken, but do
not read a radial pass over a 20-step flow as a bug.

### Grid does not tuck notes beside their screen

`gridPositions` groups by type (in the order types first appear, so no type name is hardcoded)
and fills row-major with per-column widths and per-row heights. Placing a note next to the
screen it annotates would be better and is not done.

### Thumbnails are data, not renders

`previewOf` normalises the positions already in the snapshot into a unit box; `ScapeThumbnail`
draws circles and hairlines. No offscreen canvas render, no cache, no invalidation story.

### The router grew one feature

`match("/s", route)` reads a single trailing path parameter. A nested path returns null rather
than a partial match, so a future `/s/<id>/settings` fails loudly instead of loading the wrong
scape. A second parameter or nested routes is the point to swap in a real router.

## Naming

- The domain type is `ScapeObject`, not `Object` — `Object` shadows the JS global in every
  module that imports it. `Artifact` appears only in user-facing copy, per the naming rule.

## `LayoutScape` carries engine-computed positions

The AI layer never emits coordinates, per the locked decision. But Dagre's output has to
land in the store somehow, so `LayoutScape` is an action whose payload *is* a full set of
`{ id, x, y }` positions — computed by the canvas engine, dispatched as one transaction, and
treated by the reducer like any other action with a computed (not model-authored) inverse.
This is not the AI emitting coordinates; it's the one place in the system that is allowed to.

## Router

`src/app/router.tsx` is a 30-line hash router, not `react-router` — the locked stack has no
router in it and the route set is fixed (the app plus four dev harnesses). If routing ever
needs params or nested routes, swap this file and note the new dependency.

## `SetViewState` is non-undoable

Camera pans/zooms are dispatched and logged like any action, but `SetViewState` is in
`NON_UNDOABLE_ACTIONS` in `src/core/store.ts` — otherwise panning the canvas would push undo
entries, and `Cmd+Z` after a scroll would undo the scroll instead of the last real edit. This
was found and fixed as a real bug during the AI/canvas integration, not designed in from the
start.

## Global undo/redo was never wired into the real app

`src/canvas/Canvas.tsx`'s own `onKeyDown` handles Escape, Delete, Cmd+D, Enter and arrow
nudges, but never Cmd+Z/Cmd+Shift+Z — that shortcut only existed inside the `/dev/canvas`
harness (a `window` keydown listener local to that dev route). The app shell had no
equivalent, so undo/redo did nothing outside the dev harness. Found live while walking the
acceptance script in Chrome: dragging a node and pressing Cmd+Z had no effect. Fixed by
adding the same global `window` keydown listener (guarded against firing while a field has
focus) in `src/app/Shell.tsx`, mirroring the dev route's implementation. Confirmed fixed live
— a drag now reverts correctly on Cmd+Z.

## ~~`tokens.css` gap~~ — closed

There is now a `:root.light` twin of `:root`, so a surface can force light without restating
tokens. Both selectors are pinned to `:root`: React Flow puts its own `light`/`dark` class on
the canvas container, and an unscoped `.light` would match it and hold the whole canvas light
while the rest of the app went dark.

## Stubbed / not built (deliberately, per `CLAUDE.md` scope)

- Second AI provider (`src/ai/provider.ts` is structured for it, not built).
- ~~Rename/duplicate scape actions in the sidebar.~~ Built in the product shape pass — the
  sidebar itself is gone, and rename, duplicate, export and delete are row actions on the home
  page's scape list.
- Everything explicitly out of scope in `CLAUDE.md`: MCP server, multi-provider, Tauri,
  SQLite, collaboration, version history UI, templates, tags, archive, search, rich text
  editing, Storybook, Playwright, Turborepo.

## Wireframe layout pass (`feat/wireframe-layout`)

### Core changes wanted, not made (`src/core` is frozen)

All three are now closed. Kept here because the reasoning is the record of why the actions
look the way they do.

1. ~~**`ScapeObject` has nowhere to put a size.**~~ `width?: number` now lives on
   `ScapeObject`, written by a `ResizeObject` action carrying its own inverse. Absent means
   "use the type's default", so changing a default still moves every card nobody has resized
   by hand. v1 `.scape` files migrate their wireframe `data.width` on open.
2. ~~**`UpdateObject.patch.data` replaces rather than merges.**~~ There is now a distinct
   `MergeObjectData`. Both actions exist because their inverses differ: a replace inverts to
   the previous `data`, but a merge cannot invert to another merge — a merge has no way to
   say "remove the key I just added" — so `MergeObjectData` inverts to a *total*
   `UpdateObject` carrying the whole prior `data`. It is engine-only and deliberately not an
   AI tool: a model that can merge can grow `data` one key at a time past whatever the plugin
   schema validated, so every AI write stays a full, validated object.
3. ~~**`SETTING_KEYS` has no entry for the composer's type filter.**~~ Fixed in the product
   shape pass: it is `SETTING_KEYS.generateTypes`, read and written through
   `src/app/useAppSettings.ts`. (`src/app/Shell.tsx` no longer exists; it split into
   `Home.tsx` and `Editor.tsx`.)

### Duplicated constant

`DEFAULT_WIDTH = 380` exists in both `src/canvas/layout.ts` (as `NODE_WIDTHS.wireframe`) and
`src/objects/wireframe/schema.ts`. The objects workstream cannot import from the canvas
workstream, so they are kept in step by hand. Both are commented.

### `tokens.css` additions

Two utility classes, no token values touched: `.range-field` (the width slider — `accent-color`
alone leaves the platform's own track behind, which reads as near-black on a warm light
surface) and the existing `.focus-self`. Shared `Select` primitive now lives at
`src/design/Select.tsx`.

### Pre-existing, not fixed

`/dev/objects` logs a React nesting warning: `PreviewCard` renders a `<button>` that contains
`ExpandToggle`'s `<button>`. Harness-only, predates this branch.

## Merge migration and bundle pass (`feat/merge-object-data`)

### `MergeObjectData` existed but nothing used it

The action, its inverse and its reducer tests all landed with the width pass. No call site was
ever migrated, so every plugin still wrote `data` wholesale and had to hand-spread
`object.data` first — the exact mistake the action was added to make impossible, still
reachable in five places. All five now merge:

- `note/Inspector.tsx`, `note/Node.tsx` — `body`
- `journey/Inspector.tsx`, `journey/Node.tsx` — `steps`
- `wireframe/Inspector.tsx` — its `patch` helper, which no longer spreads anything

The remaining `UpdateObject` dispatches in `src/objects/**` are all title-only, which is what
that action is now for. No behaviour changes today, because none of the three plugins currently
keeps a second key in `data` — the point is that adding one is no longer a silent data-loss bug.

`objects.test.tsx`'s "carries the rest of data through" test now runs the dispatched payload
through the real reducer rather than asserting on the patch shape, and checks the undo as well:
the payload carries one key, the untouched key survives, and the inverse restores `data`
exactly.

### jsPDF's raster dependencies are stubbed, not shipped

`render.ts` draws with jsPDF's vector primitives only — no `addImage`, no `.html()`, no SVG —
but jsPDF statically reaches for `html2canvas`, `canvg` and `dompurify` for paths we never
call. That was 391 kB raw / 113 kB gzipped of code that could only ever be dead.

`vite.config.ts` now aliases all three to `src/persistence/pdf/no-raster.ts`, which **throws**
rather than no-ops: reaching one means someone added a raster or SVG path to the export, and
that decision triples the size of the export chunk, so it should fail loudly. Removing the
alias restores the real dependencies.

The alias applies to Vitest too, which is what makes the new `render.test.ts` worth having: it
is the only test that puts the real jsPDF behind the layout (`document.test.ts` deliberately
uses a fake measurer), so it is what fails if the export ever starts rasterising.

One wrinkle worth knowing: jsdom's `Blob` has no `arrayBuffer()`, and node's `Response` will
not accept a jsdom `Blob` — it stringifies it to `[object Blob]` and the assertion fails on
mangled bytes rather than erroring. The test reads through `FileReader`, which jsdom does
implement.

### Not done

The main entry chunk is still 778 kB (247 kB gzipped) and warns on every build. Splitting it is
a real piece of work — React Flow and the app shell dominate it — and was out of scope here.

## Publishing wave 0 — integrator, sequential

Per `.context/publishing-plan.md`. Nothing here is a feature; it is the set of single-owner
files that would otherwise be four merge conflicts.

### `src/core` was opened again, narrowly

Two changes, both flagged in the plan before they were made:

1. **`registry.ts` grew a second glob**, `/src/objects/*/view.ts`, with a `ViewPlugin`
   interface and `getViewPlugin` / `allViewPlugins`. The alternative was a parallel set of
   read-only components under `src/viewer/`, which is two renderers per object type forever
   and guaranteed to drift. The second *file* rather than a second field on `ObjectPlugin` is
   the whole point: `index.ts` reaches the store, the inspector and the action protocol, and
   `view.ts` must reach none of them. Splitting the entry point makes that provable by a
   bundler instead of enforceable by code review.

   `ViewObject` is `ScapeObject` minus the timestamps, because the published projection does
   not carry them. `ScapeObject` is assignable to it and not the reverse, so one component can
   serve both surfaces and the narrowing runs the right way.

2. **`types.ts` gained `PublicationRecord` and `PublicationStore`**, and `ScapeRepository`
   gained a `publications` field. The store hangs off the repository rather than standing
   alone because two of its invariants are really invariants of `remove` and `duplicate`:
   deleting a scape must not strand a row keyed on it, and duplicating one must not hand the
   copy the original's public URL. Both implementations and the conformance suite moved
   together, and the suite asserts both.

### Dexie is at `version(2)`

Purely additive — one `publications` table, no upgrade function, the three existing stores
carried forward untouched. It lands in wave 0 even though only agent D consumes it, because a
schema migration is the one thing that must never be written twice in parallel: two branches
each defining a `version(2)` produce databases that disagree about what version 2 is, and the
loser's is already on a user's disk.

`remove()` deletes the local publication row in the same transaction. That is the *local* row
only — taking the publication down on the server is the caller's job, and the UI is required
to offer "Unpublish & delete" rather than leaving a public URL serving a document its author
believes they deleted.

### The build is split, and it is genuinely split

`index.html` and `view.html` are two Rollup inputs, so the separation is structural rather
than tested-for. Verified against a real build: the viewer's module graph is `view-*.js` plus
the shared React chunk, and contains no `@ai-sdk`, no `zustand`, no `dexie`.

**One trap for agent B's `bundle.test.ts`:** a naive
`expect(bundle).not.toContain("dangerouslySetInnerHTML")` over the viewer's whole reachable
graph **fails today**, because that string lives in `react-dom`, which both entries share. The
assertion has to run over the viewer's own chunks — `view-*.js` and anything only it imports —
not the shared vendor chunk. Same applies to any needle a dependency might mention in passing:
assert over what the viewer contributes, not over everything it can reach.

### CSP: two hashes now, one block still

`view.html` has its own pre-paint theme script. It reads `prefers-color-scheme` and nothing
else, because a page rendering a stranger's document has no business reading the author's
stored theme out of `localStorage`. Its hash is in `public/_headers`, and `csp.test.ts` now
recomputes hashes across both HTML entries rather than just `index.html`.

`_headers` deliberately still has a single `/*` block. Cloudflare Pages *merges* matching
rules and browsers intersect multiple CSP headers, so adding an `/embed/*` block granting
`frame-ancestors *` underneath would not loosen anything — it would be intersected against
`frame-ancestors 'none'`, and the embed would stay blocked while looking like a code bug.
Narrowing `/*` first is wave 2's job.

### Service worker

`CACHE` is `precipice-v2`. `/p/` and `/embed/` navigations are not handled at all, so they
behave exactly as they would with no service worker installed, and the offline shell fallback
is independently path-gated as a second line of defence. Without this, an offline published
link served `/index.html` — showing a stranger the editor, listing the *reader's* own scapes,
in place of the document they followed a link to.

`src/app/sw.test.ts` is new. `sw.js` is a classic script, not a module, so it is evaluated
against a stub `self` rather than imported. It is the first coverage that file has had.

### `_redirects` targets `/view`, not `/view.html`

Found by running `wrangler pages dev dist` rather than trusting the file. Cloudflare Pages
serves HTML extensionless and **308-redirects** any URL that resolves to a `.html` path, so a
`/view.html` target silently converts the `200` rewrite into a redirect: `/p/pub_test` became
a redirect to `/view`, throwing the publication id away and landing every published link on a
viewer with nothing to render.

This is invisible locally in the obvious ways — `vite preview` does not read `_redirects` at
all, and the file *looks* right. Wave 1's agent B would have hit it as "the viewer never gets
an id" and debugged it as a code bug. `src/viewer/entry.test.ts` now pins the target.

### Deliberately not done in wave 0

- No `view.ts` files. The glob is live and matches nothing, so `allViewPlugins()` is empty and
  `registry.test.ts` tests the mechanism rather than its contents. Workstream B fills it.
- `src/viewer/main.tsx` is a stub that renders "Viewer". It exists so the second entry is real
  from the first commit.
- No `worker/publish/**`, no `wrangler.publish.toml`, no auth. That is agent A's, and it is
  the long pole — start it first.
- `src/publish/contract.ts` declares `LIMITS`, but nothing enforces them yet. The Worker's
  enforcement is the one that matters; the client's is a courtesy.
