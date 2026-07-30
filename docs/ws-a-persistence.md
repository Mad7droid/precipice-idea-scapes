# Workstream A — Persistence

Read `/CLAUDE.md` first. It overrides anything here that conflicts.

## Goal

A Scape survives a crash, a refresh and a restart, with no Save button — and can leave
the app as a portable file and come back.

## You own

- `src/persistence/**`
- `src/routes/dev/persistence.tsx`

You touch nothing else. `src/core/` is frozen.

## Build

**1. Dexie schema** — `src/persistence/db.ts`

Tables: `scapes` (id, name, updatedAt, objectCount, snapshot), `actions` (id, scapeId, ts,
txId, action), `settings` (key, value). Version the schema from `1`; you are the only
workstream that ever touches it.

**2. Repository** — `src/persistence/scapeRepository.ts`

Implement the `ScapeRepository` interface from `src/core/types.ts`. Everyone else talks to
this interface, never to Dexie. Methods: `list`, `get`, `create`, `rename`, `duplicate`,
`remove`, `saveSnapshot`, `appendActions`, `getActionLog`.

**3. Autosave** — `src/persistence/autosave.ts`

Subscribe to the Zustand store. Debounce 300ms, then write a full snapshot. Also append
any actions accumulated since the last write to the action log. Coalesce rapid drags into
one write — a node drag must not produce 40 IndexedDB transactions.

Flush synchronously on `visibilitychange` → hidden and on `pagehide`. Losing the last
250ms of work because someone closed a tab is the bug this exists to prevent.

**4. Export / import** — `src/persistence/portable.ts`

`.scape` is JSON: `{ version, scape, actionLog }`. Export downloads via Blob. Import
validates with the Zod schema from core, rejects loudly on failure with a message that says
what's wrong, and always creates a *new* scape rather than overwriting an existing one.

**5. Settings store** — `src/persistence/settings.ts`

Key/value. Holds the API key, theme preference (`system | light | dark`), and last opened
scape. The API key is stored in plain text; that's the locked decision, and it's the
settings UI's job to say so.

**6. In-memory mock** — `src/persistence/memoryRepository.ts`

Same interface, backed by a Map. Export it. B, C and D will use it so they aren't blocked
on you.

## Dev route

`/dev/persistence` must let a human, with no other workstream merged:

- Seed the fixture scape from `core/fixtures.ts`
- Mutate it, watch the "last saved" timestamp update after the debounce
- Hard-refresh and see the mutation survive
- Export the file, delete the scape, re-import it, confirm it matches
- View the raw action log in a table

## Tests

- Round trip: `export → import` deep-equals the original scape
- Autosave debounce: 50 rapid mutations produce exactly one snapshot write
- Import rejects a malformed file without corrupting existing data
- Repository conforms to the interface for both Dexie and memory implementations
  (run the same suite against both)

## Watch out for

- Dexie writes are async and can interleave. Guard the snapshot write with a
  monotonically increasing sequence number and drop stale writes.
- Don't store the Zustand store object. Serialize through the core serializer only.
- Quota errors are real for large scapes. Catch, and surface through `core/notify.ts`.

## Done

Every dev-route bullet demonstrable, `pnpm test` green, `pnpm build` clean, nothing
outside `src/persistence/**` modified, `NOTES.md` written.
