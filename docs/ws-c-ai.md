# Workstream C — AI

Read `/CLAUDE.md` first. It overrides anything here that conflicts.

## Goal

A prompt becomes a stream of validated actions that land on the canvas one at a time, and
the whole generation undoes as a single step.

This workstream owns the product's signature moment. Budget time accordingly.

## You own

- `src/ai/**`
- `src/routes/dev/ai.tsx`

## Build

**1. Provider client** — `src/ai/provider.ts`

Vercel AI SDK, Anthropic only in v1. Direct browser calls require the
`anthropic-dangerous-direct-browser-access: true` header. Key comes from the settings
repository interface in core — you never touch Dexie.

Structure the module so a second provider is a new file, not a refactor. Do not build the
second provider.

**2. Context projection** — `src/ai/context.ts`

**This is the hard part and it determines output quality more than the prompt does.**

Turn a Scape into a compact text projection under a token budget (start at 4k):

- Always: scape name, object count, and one line per object — `id · type · title`
- Full body for: selected objects, their immediate neighbours, and anything created in the
  last transaction
- Relationships as an adjacency list, not prose
- Truncate the middle, never the ends — recent and selected context matters most

Write this against a synthetic 200-object scape, not the 12-object fixture. The fixture
will not reveal the failure mode.

**3. Action tools** — `src/ai/tools.ts`

One AI SDK tool per action type, parameters taken directly from the Zod schemas in
`src/core/actions.ts`. Do not redefine the schemas.

`CreateObject` **must not accept `x` or `y`.** If the model can supply coordinates it will,
and they will be bad. Layout is the engine's job.

**4. Streaming apply** — `src/ai/generate.ts`

`streamText` with `maxSteps`. As each tool call resolves:

1. Zod-parse it. On failure: drop, increment `skippedCount`, keep going.
2. Stamp it with the transaction's `txId`.
3. Dispatch through `applyAction` immediately.
4. Emit it to the ribbon channel.

Run Dagre after every 3 actions, not after every one — reflowing on each action makes the
canvas thrash.

Support cancel: an abort signal that stops the stream and leaves already-applied actions in
place, undoable as one transaction.

**5. Generation ribbon** — `src/ai/Ribbon.tsx`

The signature element. See `docs/design-language.md` for the full spec. Short version: a
thin strip above the composer, one mono line per action as it lands
(`CreateObject · journey · "Verify identity"`), `animate-ribbon-line` on entry. On
completion it collapses to `18 actions · claude-sonnet-4-6 · undo`, and that undo reverses
the whole `txId`.

If actions were skipped, the collapsed line says so: `18 actions · 2 skipped · undo`.
Clicking the count opens a popover listing what failed validation and why.

**6. Composer** — `src/ai/Composer.tsx`

Per the design spec. Docked bottom-centre, `max-w-[720px]`, `--bg-inset` well,
`rounded-2xl`, hairline that becomes `--border-focus` on focus. Icon row inside the well.
Filled circular send button in `--accent`, disabled to `--bg-inset` when empty.
Cmd+Enter sends. Auto-grow to 6 lines then scroll.

**7. Eval fixture** — `src/ai/evals.ts`

Five prompts with expected shapes (object count range, required types, minimum edge count).
A script that runs them and prints a pass/fail table.

**Build this in your first 30 minutes, not your last.** It is how you will know whether
the context projection and tool schemas are any good while there's still time to fix them.

## Dev route

`/dev/ai` — key entry, prompt box, live ribbon, applied-action list, skipped-action list,
token count for the projection, and a "run evals" button. Works against the in-memory
repository and a fake canvas sink, with no other workstream merged.

Also ship a recorded action stream fixture so the ribbon and apply loop can be exercised
without an API key or network.

## Tests

- Malformed tool call is dropped, counted, and does not halt the stream
- All actions from one generation share a `txId`
- Undo after generation returns state to exactly pre-generation
- Cancel mid-stream leaves a consistent, undoable state
- Context projection stays under budget for a 200-object scape

## Watch out for

- The model will try to create relationships to objects that don't exist yet if it plans
  poorly. Validate that both endpoints exist; drop and count if not.
- Don't `await` the full stream before applying. Progressive application is the feature.
- Rate limits and auth failures need real error copy: what happened, what to do.

## Done

Every dev-route bullet demonstrable, evals runnable, `pnpm test` green, `pnpm build` clean,
nothing outside `src/ai/**` modified, `NOTES.md` written.
