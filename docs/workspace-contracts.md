# Workspace UX contracts

These additive contracts cover the shared browser/macOS UI. They do not change the Action
Protocol, document schema, database version, publication schema, OAuth, agent scopes or native IPC.

## Local settings

| Key                          | Data                                | Meaning                                          |
| ---------------------------- | ----------------------------------- | ------------------------------------------------ |
| `ui.interfaceStyle`          | `current`, `graphite`, `field`      | Interface palette; defaults to Current           |
| `ui.theme`                   | Existing `system`, `light`, `dark`  | Independent appearance                           |
| `workspace.opened.<scapeId>` | Finite timestamp                    | Last opened; never changes edited time           |
| `workspace.state.<scapeId>`  | `active`, `parked`, `done`, or null | Optional local organization; independent of pins |
| `workspace.capture.<uuid>`   | Validated Capture                   | Separate durable Inbox record                    |

Capture contains a UUID, trimmed text (1 to 20,000 characters), finite created/updated timestamps,
archived flag, and optional promotion receipt (scape/object IDs). One record per capture avoids
lost updates from rewriting a shared Inbox array. Capture accepts at most 1,000 records, archived
included. Archive is reversible; promoted originals remain recoverable. Only archived records can be
deleted, after an inline confirmation; deletion never touches a scape the note was added to. If
that scape was deleted, the Inbox shows this instead of an Open link. Imported captures receive new UUIDs.
No credential, AI transcript or unsent prompt belongs in these records.

Work state, opening, pinning and appearance never change document edit time, history or public
projections. Local organization is not portable in this release. Browser and desktop stores remain
separate; no cloud synchronization is introduced.

## Capture and promotion

Capture is available from navigation, editor controls and command palette. Cmd/Ctrl+Alt+N is
app-scoped; Cmd/Ctrl+Shift+Space remains dictation. Capture works offline without AI. The form clears
only after its record commits. Failure preserves text. Closing preserves the in-memory draft for
this app session, not across quit.

Promotion takes the destination's existing writer lease without takeover. An open destination is
refused rather than overwritten. One IndexedDB transaction applies reducer actions, writes snapshot
and action log, and archives the source with a receipt. Failure rolls back all writes. Retry returns
the receipt rather than creating another note. New destinations use IDs derived from the source
UUID. Existing documents pass normal migration/validation. If a destination is later deleted,
the original captured text remains available in Archived Inbox.

## Backup compatibility

Library export includes all Inbox records, including archived originals, represented as ordinary
version-3 note scapes inside the existing version-1 library envelope. Advisory `meta.inboxCapture`
metadata lets this build restore them to Inbox. Older builds restore ordinary editable note scapes:
the text remains readable. Portable format and database versions are unchanged. Imports validate
all captures before committing and create new IDs. A malformed Inbox marker imports as an ordinary
note scape; an import that would exceed 1,000 Inbox records is rejected whole. Credentials, preferences, publication ownership,
action history and session drafts remain excluded. The 1,000-scape limit counts scapes only;
Inbox records have their own 1,000 limit, so a library file holds at most 2,000 entries within
the existing 100 MB bound. Builds before this change reject files over 1,000 entries.

## Sessions and retrieval

Viewport recovery uses the existing path. Validated per-scape localStorage metadata under
`precipice.editor.session.<id>` holds optional panel geometry/visibility and bounded selection IDs.
Stale selections are dropped; narrow windows still collapse panels. Unsent editor drafts use
tab-session storage only, capped at 20,000 characters. Restoring never sends or replays a request.
Existing AI-conversation retention is unchanged.

Content search reads names, object titles/types/tags and authored object data through repository
APIs. It excludes credentials, instructions, drafts and AI transcripts. Its disposable in-memory
cache follows document revisions and removes deleted documents on the next query. Results contain
bounded excerpts rendered as React text. Navigation passes IDs in memory, not content in URLs,
and focuses a valid object after normal boot. Search uses no network service or embeddings.
Cmd/Ctrl+Shift+F opens it; Home Cmd/Ctrl+K opens it while editor Cmd/Ctrl+K retains commands.

## AI actions and boundaries

Summarize, Open questions, Extract decisions, Next steps and Outline a plan prepare an Ask draft.
They do not send, edit, change models, publish or expand agent permissions. Selection and scope
controls remain visible. The user sends and separately chooses Edit to apply changes through
existing validation, cancellation and undo. Existing contextual questions remain available.

Public viewing retains its separate persistence-free graph. Native permissions, Keychain, consent,
OAuth and network rules are unchanged. Semantic search, scheduled digests and automated daily
summaries remain conditional future experiments.
