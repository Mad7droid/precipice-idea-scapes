# UI and interaction review

Date: 2026-10-25. Status: design recommendations pending; implementation progress recorded below.

## Evidence and limits

Reviewed the current design tokens, shared controls, editor layout, settings, top bar,
and publishing dialog against the existing fictional-data screenshots in
`.context/ux/shots/`. Screenshots are historical evidence from the earlier review;
this is not a fresh browser or installed-Mac acceptance run. Previously reported
behavioral defects still need regression checks against the current working tree.

## Recommendation

Rebuild the editor shell and shared interaction foundations before polishing individual
screens. The canvas needs a clear hierarchy and predictable editing behavior. Preserve
the product's warmth, but reduce decorative typography, competing controls, and persistent
AI branding. A framework rewrite is not justified by this review.

| Priority | Area and evidence                                                                                                                                                               | Recommended change                                                                                                                                                                                      | Acceptance                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Responsive shell: `src/app/Editor.tsx:780` and `:1014` allocate independent nonshrinking panels; historical 800px screenshots show clipped content                              | Budget space across the whole editor. Collapse the outline and show one inspector/assistant overlay when the canvas cannot retain a useful working width. Preserve viewport location when panels change | At 800, 1024, 1440, and 1920px, controls remain reachable and opening a panel does not strand the selection offscreen                              |
| P0       | Editing contract: prior review reports focus, selection, and draft-transfer defects                                                                                             | Define one selection source; scope shortcuts to canvas focus; focus new content directly; preserve or commit drafts before selection changes; make a drag one undo step                                 | Pointer and keyboard selection agree; typing never creates unrelated blocks or edits another block                                                 |
| P1       | Typography: `src/design/tokens.css` uses pixel display headings and an uppercase 11px metadata class                                                                            | Use the UI sans face for product headings and settings. Reserve distinctive type for a restrained brand treatment. Establish readable body, label, heading, and metadata roles                          | Essential text is readable at normal zoom in both themes; labels do not rely on tiny uppercase text                                                |
| P1       | Surface hierarchy: warm dark surfaces, muted labels, faint separators, and many outlined pills compete in the screenshots                                                       | Retune semantic foreground/surface tokens together. Use borders for grouping and state, fewer pill treatments, and a distinct selection treatment                                                       | Normal text clears 4.5:1; large text and required control/state indicators clear applicable 3:1 thresholds; selection is clear without color alone |
| P1       | Navigation: `src/app/TopBar.tsx:129` and editor controls spread assistant, theme, export, insertion, and canvas actions around the workspace                                    | Keep document identity and sharing in the header; group insertion and canvas navigation; move theme preference into settings; give the assistant one consistent entry point                             | Users can identify where to add, edit, navigate, and share without exploring several toolbars                                                      |
| P1       | Canvas cards: screenshots show tiny type strips, repeated empty titles, and large gaps at fit zoom                                                                              | Standardize card header, title, content preview, selected state, and connection affordances. Tune initial placement and fit behavior; use reduced detail only at deliberate zoom thresholds             | A populated fictional canvas is legible at default zoom; empty blocks invite a useful next action                                                  |
| P1       | Home: first-run screenshot prioritizes mascot, prompt, model, template pills, empty creation, and import simultaneously                                                         | Make the populated home a library first. Give first-run users clear create and open-example actions, with AI setup as an optional guided path                                                           | A user can start manually without configuring AI; returning users can resume recent work immediately                                               |
| P1       | Assistant: `src/app/Editor.tsx:843` onward has canvas answer/composer and panel variants; screenshots repeat the mascot and modes                                               | Prefer one stable assistant workspace with explicit Ask/Edit and scope. Show progress, errors, cancel, retry, and proposed changes in place                                                             | Closing/reopening preserves the request; failures never appear as blank answers; changes are reviewable before application                         |
| P1       | Overlays: `src/publish/PublishSheet.tsx:104` has a fixed 440px surface; `src/design/Menu.tsx:58` closes without restoring focus itself; toolbar menu uses mouse-leave dismissal | Share dialog/menu behavior: constrained sizing, Escape, focus containment for modals, focus return, keyboard navigation, and predictable dismissal                                                      | Complete publish/settings/menu tasks with keyboard alone and at narrow widths                                                                      |
| P1       | Connection feedback: historical settings show Ready for unverified key input                                                                                                    | Distinguish configured, checking, connected, rejected, and unavailable. Keep recovery beside the failed action and route directly to the relevant setting                                               | A saved value does not imply successful authentication; failed requests retain the user's draft                                                    |
| P2       | Feedback: duplicate setup toasts and subtle save status in screenshots                                                                                                          | Use persistent inline feedback for connection/save failures; deduplicate transient notifications; report Saved only after successful persistence                                                        | Repeated actions do not stack identical messages; unsaved work and recovery remain visible                                                         |
| P2       | Component foundation: shared Button/Menu/Select exist, but custom toolbars and dialogs have separate behavior                                                                   | Extend shared foundations with Field, IconButton, Dialog, Tooltip, SegmentedControl, EmptyState, and status patterns; migrate incrementally                                                             | Shared controls have consistent spacing, targets, focus, disabled, loading, error, and press states                                                |
| P2       | Motion: editor panels transition width; reduced-motion token support already exists                                                                                             | Keep frequent editing feedback immediate; use project motion tokens for overlays; avoid unnecessary animated layout work; preserve reduced-motion support                                               | Rapid toggling does not snap or lose focus; reduced motion preserves state comprehension                                                           |
| P2       | Desktop trust: unwanted launch is user-reported; platform wording and quit/download issues are in the earlier review                                                            | Prevent client initialization from opening/focusing the GUI; use platform-aware labels and verify native quit/download handling separately                                                              | Starting Claude Desktop or Codex leaves Precipice closed; installed-Mac behavior is manually verified                                              |

## Performance and memory requirement

Every fix must preserve responsiveness and avoid unnecessary memory use. Keep drag frames
local, persist at gesture completion, and preserve unchanged object identities. Avoid new
background polling, unbounded histories/caches, duplicated document state, and subscriptions
without cleanup. Verify behavior with realistic populated canvases as the shell is updated.
Broader rendering and memory profiling remains pending; passing functional tests alone does
not establish a memory budget or a measured performance improvement.

## Additional visual requirement

Text and icons on orange currently feel inconsistent and too strong (user feedback).
Audit all filled action surfaces and their hover, pressed, disabled, and loading states.
Use one foreground pairing per fill in each theme, make icons inherit the label color,
and normalize icon size and stroke weight. Reduce bright orange coverage; selected
controls should use a subtle surface rather than resemble primary actions. Verify
contrast before reducing visual intensity. This work is pending.

## Implementation order

1. Resolve persistence, selection, focus, and unwanted-launch correctness first.
2. Define shell states, editing rules, type roles, surface hierarchy, and component variants.
3. Apply those foundations to one populated editor with inspector and assistant states.
4. Carry the same system through Home, settings, publishing, public viewer, and desktop chrome.
5. Verify both themes, keyboard-only use, narrow screens, zoom, reduced motion, and realistic content.

Use isolated fictional data for new screenshots. Document which checks are automated,
which are manual, and which remain unverified. Do not treat the historical screenshots
as proof of current runtime behavior.

## Fix progress

- Completed: shared snapshot sequence across autosave sessions, file imports, public-copy
  creation, and the persistence harness. Added regressions for reopening, imports,
  one-off copy writes, and failed-save accounting. Updated CHANGELOG.md.
- Validation: 71 tests passed across persistence, library transfer, and App suites.
  The broader run passed 861 tests but could not load the pre-existing unfinished
  `src/ai/useGeneration.test.tsx`, which imports unavailable `@testing-library/react`.
  That same import blocks TypeScript checking. This is not a clean full verification.
- Completed in source: removed GUI launching from the native MCP helper. It serves
  generated discovery metadata offline, returns an actionable error for library calls,
  and reconnects after manual app open/reopen without restarting the client. Updated agent
  setup copy, MCP/desktop docs, and changelog. Native tests: 30 passed, 3 intentionally
  ignored. MCP tests: 27 passed. A built-helper subprocess check passed offline discovery,
  closed-app errors, two reconnect cycles, handshake replay, and clean exit using an
  isolated socket and fictional app responses. The installed GUI has not been replaced;
  real-client acceptance remains pending. TypeScript checking still encounters the same
  pre-existing missing test dependency recorded above.
- Completed: multi-block drag commits all dragged positions in one transaction. A
  regression first reproduced the old failure, then passed after the callback fix.
  Checks cover autosave/reload, group undo/redo, single-block drag, no-op drag, read-only
  protection, and unchanged object identities. Forty intermediate drag frames produce
  no document actions or saves; releasing the drag yields one snapshot on flush. No new
  polling, listeners, or retained drag history were added. Related suites: 118 tests passed.
  TypeScript checking remains blocked by the pre-existing AI test import noted above.
- Completed: selection is authoritative in the document store. Pointer selection changes
  enter through `onNodesChange`; canvas flags follow outline, keyboard, and command changes
  without replacing live positions or measurements. Removed the separate selection-notification
  feedback path. Selecting a block also clears stale edge selection. Regression coverage
  includes real React Flow mount/click behavior, outline clicks and Delete, Alt+Arrow,
  select-all/Escape, pointer selection, read-only mode, primary selection order, and stable
  node/array identities. Related suites: 127 tests passed. The same pre-existing missing
  AI test dependency still blocks full TypeScript verification.
- Completed: new blocks focus the first enabled field in plugin content (the title for
  all four current types), excluding tag controls. Existing deferred focus now verifies
  the requested block is still selected. Actual Editor/Canvas tests first reproduced tag
  focus and now cover N/J/W/S creation, editing the title without changing tags or creating
  extra blocks, Enter/double-click reopening, and stale focus requests. Related suites:
  91 tests passed. No additional listeners, polling, caches, or recurring tasks were added.
  Full type-checking still reports the pre-existing missing AI test dependency.
- Awaiting user confirmation: make external/public links open correctly in the Mac app.
- Pending: orange action text/icon consistency and all other review findings.
