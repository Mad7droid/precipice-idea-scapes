# Precipice design language

Light-mode follow-up, 9 November 2026: selected navigation combines a stronger semantic fill
with a hairline accent outline that follows the item's radius (`workspace-selected`). No side
bars or edge strokes on selected items. Never depend on a barely tinted fill
alone. Graphite and Field use distinct neutral page, card and inset surfaces. Dark palette
values are unchanged. Editable search/capture/Inbox fields explicitly specify primary text,
tertiary placeholders and selected-text colors; font-size utilities must not set color.

Inbox uses the user-selected compact-card layout: two columns on wide windows and one column
on narrow windows. Keep the note text intact with a small date above and compact actions below.
Do not add a colored spine, redundant Note label, shadow or separate footer strip. Show destination
controls only after Add to scape; expose expansion state accessibly. Editing exposes Save/Cancel
and disables archive/promotion. No faux paper textures, folded corners, new fonts or ornamental motion.

This is the current interface contract. The previous proposal is archived in
[design-language-legacy.md](design-language-legacy.md). Source values live in
`src/design/tokens.css` and `src/design/interface-styles.css`.

## Identity and styles

Settings → General has independent Interface style (Current, Graphite, Field) and
Appearance (Light, Dark, System) choices. Current is the default and preserves the existing
warm Ash neutrals, orange interaction signal and deep rust primary actions. Graphite uses cool
neutrals and mineral green; Field uses stone neutrals and violet. All three share geometry,
features, typography and interaction behavior. No style forces dark mode or changes content.

Preserve the existing logo, app icon, approved orange Scapi artwork, Inter and Geist Pixel.
Do not replace identity with stock icons or recolour artwork with CSS filters. Scapi stays
orange across styles. Object types, user markers and success/danger/warning/info roles remain
independent. Never recolour authored wireframes or write a palette into a document.

Components consume semantic tokens. Shared controls remain Button, Select, Menu and the existing
focus-managed dialogs. Do not add component-local palette literals, new fonts or theme packages.
Alternative palettes override colour roles only; Current inherits tokens.css without overrides.
Keep selectors scoped to :root because React Flow also applies .light and .dark to its containers.

## Persistence

`ui.interfaceStyle` is an additive local setting, independent of `ui.theme`.
Its non-sensitive `precipice.interfaceStyle` mirror applies the allowlisted palette before first
paint. Keep the exact inline-script hash synchronized with public/_headers. A late hydration
read cannot overwrite a new choice; writes serialize and failed persistence restores the last
saved style with an error. A blocked mirror does not invalidate a successful IndexedDB write.

Browser and desktop libraries remain separate. Public viewing follows the reader's OS and never
reads editor settings. Appearance is not sent to providers, agents, publishing or analytics.
See [workspace contracts](workspace-contracts.md).

## Working interface

Returning-user Home leads with Continue working; first-use Home retains manual creation and AI
generation. New scape reveals the existing composer/templates. Preserve search, filters, sort,
pins, gallery/list, publishing, imports, backups, provider controls and keyboard navigation.

Use the existing type scale and weights: Inter for controls/prose, Geist Pixel in its established
wordmark, display and machine-label roles. Use spacing and alignment before adding containers.
Keep accessible labels, focus, busy/disabled/error states and useful metadata. A colour alone
cannot communicate published, stale, read-only or error state.

Use direct labels such as Capture a note, Save to Inbox, Continue working and Search content.
Avoid motivational greetings, invented progress scores, empty dashboard widgets, decorative
badges, gradient buttons, glass panels or glowing AI controls. Never claim Saved before a commit.

## Motion

Use existing duration/easing tokens only for state feedback or spatial continuity. Do not add
theme colour sweeps, idle pulses, random mascot reactions, confetti or routine entrance animations.
Scapi keeps its original artwork and functional status feedback. Decorative click/idle reactions
are disabled on Home and assistant working surfaces. Preserve reduced-motion behavior, explicit
cancellation and a steady viewport while reading streamed answers.

## Touch and small screens

Phones get full editing. The contract is code: `src/core/viewport.ts` (breakpoints, touch
timings, sheet snaps, the complete `GESTURES` table), `src/design/Sheet.tsx` and
`src/design/useLongPress.ts`. Layout follows width (compact < 640, medium 640–1023, expanded
≥ 1024); touch affordances follow `(pointer: coarse)` via the `coarse:` variant, never width,
so an iPad with a trackpad keeps hover and shortcuts.

Grow hit areas, not chrome: `--hit-min` is 44px on coarse pointers (`min-h-hit`, `min-w-hit`).
Inputs are 16px on touch, the one exception to the 13px default, because iOS zooms on smaller
fields; this is global in tokens.css. Every gesture has a visible twin (long-press ↔ `⋯`,
two-finger tap ↔ Undo). No screen-edge swipes, swipe-to-delete or three-finger gestures.
Sheets replace modals and side panels on compact: scrim, focus trap, swipe-down/Escape/Close
to dismiss, `--dur-base` + `--ease-out`, above the keyboard and `--safe-bottom`. The inspector
is the one non-modal sheet; it rests at peek and never takes focus from the canvas. On touch a
selection pill (Edit · Connect · Ask AI · Duplicate · More) replaces hover toolbars.

## Preview and acceptance

Compare the actual app in all six style/appearance combinations, including System/reload, Home,
Inbox, Settings, editor, focus/selection, busy/error/read-only states and narrow windows.
`docs/ux-design-preview.html` is the local preview checklist. Conversation mockups are historical
studies and are not implementation contracts. Follow [screenshot provenance](screenshots/README.md):
fictional data, isolated origin, temporary captures in .context.

Alternative text roles, primary actions, focus contrast and the identity-token boundary are
checked in `src/design/interfaceStyle.test.ts`. Measure composited states in the app too.
Target applicable WCAG 2.2 AA behavior; token tests do not establish a full accessibility audit.
