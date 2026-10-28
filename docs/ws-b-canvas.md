# Workstream B — Canvas

> Historical implementation brief. The ownership and scope restrictions below applied to the
> original workstream. Use [the documentation index](README.md) and
> [current architecture](codebase-architecture.md) for today's behavior and boundaries.

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

| Gesture                  | Action                      |
| ------------------------ | --------------------------- |
| Drag node, on drag _end_ | `MoveObject`                |
| Delete key               | `DeleteObject`              |
| Drag handle to handle    | `ConnectObjects`            |
| Cmd+D                    | `DuplicateObject`           |
| Double-click node        | opens inspector (no action) |

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

Tab and Shift+Tab move focus into and out of the canvas like any other control; they never
create blocks. E extends the selected block with a connected note (Shift+E adds one leading
into it). Enter opens the inspector, arrows nudge the selection by 8px (emitting
`MoveObject`), Alt+arrows move the selection to the nearest block, Escape clears selection.
Plain letter keys are ignored for a moment after a node double-click so typing lands in the
opening editor. Focus ring per the token file.

Store selection is the single source: React Flow's `node.selected` is derived from it, and
pointer selection writes back through `onNodesChange`. A multi-node drag commits one
`MoveObject` per dragged node in one transaction. While a generation streams, drags, nudges,
delete, undo and redo are refused (the store itself refuses undo/redo).

Dropping a connection on a card body connects to that card; only empty canvas opens
"connect to new". Tidy lays out connected blocks with Dagre and wraps unconnected blocks
into a grid beside the graph.

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
