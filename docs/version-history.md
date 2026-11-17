# Scape version history

Open **History** in the editor toolbar (on a phone, **More → Version history**), or choose
**Version history** in the command palette.

Select a saved version to explore it directly on the canvas. Pan, zoom, fit, or choose a
change to focus its block. **Show current** switches the canvas to your latest work while
keeping the same camera. The change list reads from the saved version to the current one;
select an edited block to read its before and after content.

**Restore this version** asks for confirmation. Restoring makes a new current version and
preserves the replaced state as **Before restore**. The restoration can also be undone in
the current editing session. Publishing stays an explicit separate action.

Use **Save named version** for a milestone, or select an older checkpoint and choose **Name
this version**. Named versions are protected from automatic pruning. **Delete version**
asks for confirmation and deletes only that checkpoint, not the scape.

## Capture and retention

- Ordinary changes produce checkpoints at most once every 30 seconds, with a checkpoint
  after an editing pause. Camera-only movements do not create versions.
- AI generation captures its starting state and result; interrupted or failed generations
  that leave edits get a partial AI checkpoint. Agent commits capture before/after states
  in the same transaction as their idempotency receipt.
- The current head is checkpointed when opening history. Browsing is read-only for both
  local input and connected agents. Finish a generation before entering history.
- An existing scape starts history from its saved state before its first new write. Earlier
  versions cannot be recovered retroactively from the trimmed action log.
- History has a budget of 200 checkpoints and 50 MiB per scape. Old unprotected versions are
  pruned first; named versions and the latest pre-restore safety checkpoint are protected.
  If protected history fills the budget, delete older named checkpoints. History failure
  does not prevent ordinary document autosave. A restore fails as a whole if its safety
  checkpoint cannot be saved.
- Imported and duplicated scapes have independent histories. Deleting a scape removes its
  local history too; this feature does not provide a trash folder.

History is private local data in the current browser or Mac library. It is not cloud backup,
and browser and desktop libraries remain separate. Scape/library exports do not include
checkpoints; exports may still contain the existing action log according to their format.

## Implementation

`src/history/model.ts` defines checkpoint contracts, canonical semantic comparison, and
change descriptions. `src/persistence/history.ts` provides IndexedDB and memory storage.
`PrecipiceDb` schema 4 adds the checkpoints table without changing existing document blobs.
Checkpoints carry their document migration version independently of their history ordinal.

`ScapeRepository` owns the history capability. Normal snapshot writes preserve a baseline
and capture bounded automatic history; MCP's documented direct transaction adapter and
library import include history explicitly. Snapshot writes are ordered per scape and their
sequence guard advances only after a successful write.

The optional history workspace is loaded lazily. It renders private snapshots through the
read-only object view registry, without importing editor state into the public viewer.
Historical camera movements and inspection never enter the live store or autosave.

Restore flushes pending text fields and saves, checks the head and editing lease, evaluates
an engine-only reducer action, then commits the head, pre-restore checkpoint, restoration
checkpoint, and logged restore action atomically. The store receives the action only after
commit. Its inverse provides one-step undo. Instruction counters advance when restoring;
scape identity, creation time, and the live camera remain intact.

Tests cover migration, retention, independent histories, stale head and lease rejection,
quota rollback, preview isolation, explicit confirmation, undo, and restoration after reload.
