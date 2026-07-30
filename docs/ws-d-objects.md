# Workstream D — Objects

Read `/CLAUDE.md` first. It overrides anything here that conflicts.

## Goal

Three object plugins that prove the registry pattern works — meaning a fourth type could
be added later without touching the Workspace Engine, the canvas, or the AI layer.

## You own

- `src/objects/**`
- `src/routes/dev/objects.tsx`

## The plugin contract

Each type is a folder under `src/objects/<type>/` exporting a default `ObjectPlugin` from
`src/core/registry.ts`:

```ts
{
  type: "note" | "journey" | "wireframe",
  label: string,              // user-facing, sentence case
  color: string,              // a --obj-* token name, not a hex
  schema: ZodSchema,          // the object's data shape
  defaults: () => Data,       // what CreateObject produces with no data
  Node: FC<{ object, selected }>,      // canvas body — chrome is B's, not yours
  Inspector: FC<{ object, dispatch }>, // right panel editor
  toText: (object) => string, // one-line summary for C's context projection
  aiHint: string,             // one sentence telling the model when to use this type
}
```

Registration is by convention. `src/core/registry.ts` globs `src/objects/*/index.ts`.
**Do not edit a shared index file.** Adding a folder is the entire registration step.

## The three types

**Note** — `src/objects/note/`
Title + body. The default when nothing else fits. Node shows title and three lines of body,
truncated. Inspector is a title input and a plain textarea (no Lexical, that's cut).
Colour `--obj-note`.

**Journey** — `src/objects/journey/`
Title + an ordered array of steps `{ id, label, detail? }`. Node shows the title and up to
five steps as a numbered column, then `+3 more`. Numbering is legitimate here — the order
carries real information. Inspector allows add, edit, reorder (drag), delete.
Colour `--obj-journey`.

**Wireframe** — `src/objects/wireframe/`
Title + an array of primitives `{ id, kind: "box" | "text" | "input" | "button" | "list", label?, span: 1..12 }`.
Node renders them as a stacked 12-column grid of grey blocks — a genuine low-fidelity
wireframe, at node scale. Inspector is a list editor for the primitives.
Colour `--obj-wireframe`.

Keep the wireframe primitive set exactly this small. It is a demonstration that structured,
editable, AI-generated visual artifacts work — not a design tool.

## Rules

- **Every edit dispatches `UpdateObject`.** Inspectors are controlled components with no
  local state beyond the in-flight text field. Debounce text input at 200ms so typing
  produces one action per pause, not one per keystroke.
- **No raw values.** Tokens only. If you need a colour that isn't a token, note the gap.
- Node components must render correctly at 0.4× zoom. Test at that scale — text below 10px
  effective size should drop out rather than turn to mush.
- Node bodies are height-bounded. A journey with 40 steps must not produce a 2000px node.
- Empty states inside a node say what to add: "No steps yet", not "Empty".

## Dev route

`/dev/objects` shows all three types side by side, at 1× and 0.4×, in light and dark, with
their inspectors live, running against `core/fixtures.ts`. Include one deliberately
over-full instance of each (a 40-step journey, a 30-primitive wireframe) to prove the
bounds hold.

## Tests

- Each plugin's `schema` accepts its `defaults()` output
- Registry discovers all three via glob with no manual registration
- Inspector edit produces exactly one `UpdateObject` after the debounce
- `toText` output stays under 120 characters for each type

## Watch out for

- Don't build node chrome — the card, border, type bar and id label belong to Workstream B.
  You render the body only. Duplicating chrome will conflict at merge.
- `toText` is consumed by C's context projection. Keep it dense and factual; it is what the
  model sees for every object it isn't focused on.
- The glob is eager. A syntax error in one plugin breaks all three. Keep them independent.

## Done

Every dev-route bullet demonstrable, `pnpm test` green, `pnpm build` clean, nothing
outside `src/objects/**` modified, `NOTES.md` written.
