# Notes

Deviations and gaps worth flagging, not blockers.

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
- Rename/duplicate scape actions in the sidebar — the four persistence primitives the
  acceptance script needs (new, open, delete, export/import) are wired; rename/duplicate were
  left out to stay inside the eight-item scope rather than add UI the walking skeleton
  doesn't exercise.
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
3. **`SETTING_KEYS` has no entry for the composer's type filter.** It is written under the
   literal `"ui.generateTypes"` from `src/app/Shell.tsx`. Should be folded into `SETTING_KEYS`
   alongside `theme` and `lastScapeId`.

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
