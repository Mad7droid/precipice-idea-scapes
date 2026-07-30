# Workstream B — Canvas

Read `/CLAUDE.md` first. It overrides anything here that conflicts.

## Goal

A React Flow surface that renders any Scape from the object registry, lays it out
automatically, and routes every interaction through `applyAction`.

## You own

- `src/canvas/**`
- `src/routes/dev/canvas.tsx`

You do **not** build object renderers — that's Workstream D. You build the host that
delegates to them.

## Build

**1. Surface** — `src/canvas/Canvas.tsx`

`@xyflow/react`. Dot background using `--canvas-dot`. Pan, zoom, marquee select, fit-view.
Zoom bounds 0.25–2. Canvas background is `--bg-canvas`.

**2. Generic node host** — `src/canvas/ObjectNode.tsx`

One React Flow node type. Looks up the object's `type` in the registry from
`src/core/registry.ts` and renders that plugin's node component. If the type is
unregistered, render a fallback card showing the type name in mono — never crash, never
blank.

Card chrome is yours, not the plugin's: `--bg-surface`, `rounded-lg`, `shadow-sm`, a 2px
type-coloured bar on the top edge from `--obj-*`, and the object id in mono at the bottom.
The plugin fills the middle.

**3. Edges** — `src/canvas/edges.ts`

Derive edges from `scape.relationships`. Bezier, `--edge-stroke`, 1.5px. Active/selected
edges use `--edge-stroke-active` and 2px. Labels, when present, sit in a
`--bg-raised` pill.

**4. Layout** — `src/canvas/layout.ts`

Dagre. Expose `layoutScape(scape, direction)`. This is what services the `LayoutScape`
action. Reflow animates over `--dur-canvas` with `--ease-out`.

Positions the engine computes are written back through `MoveObject` actions, batched into
a single `txId`, so a layout is one undo.

**5. Interaction → actions**

Every one of these emits an action. No direct state mutation, ever.

| Gesture | Action |
|---|---|
| Drag node, on drag *end* | `MoveObject` |
| Delete key | `DeleteObject` |
| Drag handle to handle | `ConnectObjects` |
| Cmd+D | `DuplicateObject` |
| Double-click node | opens inspector (no action) |

Drag emits on end, not on every frame — intermediate positions are local visual state.
Forty `MoveObject` actions per drag would poison undo and the action log.

**6. Camera** — `src/canvas/camera.ts`

Persist viewport into `scape.viewState`. Debounce 500ms. `focusObject(id)` flies to a node
over `--dur-canvas`.

**7. Node entry animation**

New nodes mount with `animate-node-enter` — the one permitted spring in the app. Edges
draw in 60ms after their nodes land. Under `prefers-reduced-motion` this becomes a plain
opacity fade.

**8. Keyboard navigation**

Tab cycles nodes in layout order, Enter opens the inspector, arrows nudge the selection by
8px (emitting `MoveObject`), Escape clears selection. Focus ring per the token file.

## Dev route

`/dev/canvas` loads `core/fixtures.ts` and lets a human drag, connect, delete, duplicate,
re-layout, fly-to, and undo every one of those — with no other workstream merged. Show the
live action log in a side panel so it's obvious that every gesture produced an action.

## Tests

- Drag end emits exactly one `MoveObject` with correct before/after
- `layoutScape` produces no overlapping nodes for the fixture
- Edges match `relationships` exactly after add and remove
- Unregistered object type renders the fallback rather than throwing

## Watch out for

- React Flow wants to own node positions. It doesn't. Our store is the source of truth;
  React Flow is a controlled component. Pass `nodes`/`edges` down, never rely on its
  internal state across renders.
- Don't use React Flow's built-in delete/undo handlers. Wire your own to `applyAction`.
- Memoize node components hard. A 200-node scape re-rendering every node on every drag
  frame will feel broken.

## Done

Every dev-route bullet demonstrable, `pnpm test` green, `pnpm build` clean, nothing
outside `src/canvas/**` modified, `NOTES.md` written.
