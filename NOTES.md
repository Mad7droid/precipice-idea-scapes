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

## `tokens.css` gap

`src/design/tokens.css` defines `:root` (light) and a `.dark` override class, but there is no
`.light` class. Two Scapes can't be shown side-by-side in both themes without one restating
token values by hand. Not blocking for the walking skeleton — nothing in the eight acceptance
items needs simultaneous themes — but worth closing before the design system is used beyond
this build.

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

1. **`ScapeObject` has nowhere to put a size.** Card width is stored in the plugin's own
   `data.width` instead. That works — the schema validates it and it survives export — but a
   width is a property of the card, not of a wireframe, and notes and journeys are now
   resizable through the same generic path with no schema entry of their own. A `width?:
   number` on `ScapeObject` (or a `ResizeObject` action carrying its own inverse) is the
   honest home for it.
2. **`UpdateObject.patch.data` replaces rather than merges.** Every call site now has to
   spread `object.data` before writing one key, and forgetting to is silent — the wireframe
   inspector had exactly this latent bug before this pass. A shallow merge, or a distinct
   `MergeObjectData`, would remove a whole class of mistake.
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
