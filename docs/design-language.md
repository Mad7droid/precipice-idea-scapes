# Precipice — Design Language

Reference direction: **Mistral / Le Chat.** The goal is that a designer who knows their
work would look at Precipice and assume the same studio made it — then notice it's a
canvas tool, not a chat app, and see that the system was extended rather than copied.

This document is the *why*. `src/design/tokens.css` is the *what*. Components consume
tokens; nobody writes a raw value.

---

## What actually makes Mistral's work read the way it does

Five observations, in order of how much they matter. Miss the first two and nothing else
saves it.

**1. The neutrals are warm, and they're the whole design.**
There is almost no colour in the interface. What carries it is a neutral ramp shifted to
roughly 35–40° hue at very low chroma — paper, not paper-white; charcoal, not slate. Most
teams reach for a cool grey (Tailwind's `slate`, `zinc`) and the result feels clinical.
Warm neutrals feel like an object you own. That single hue shift does more work than any
other decision here.

**2. The accent is a signal orange, not a clay terracotta.**
This is a trap worth naming. The obvious move — warm cream background, muted terracotta
around `#D97757` — is the current house style of AI-generated design, and it will read as
a tell. Mistral's orange is genuinely *vivid*: high chroma, near-fluorescent, closer to a
safety marking than to pottery. It's used at maybe 2% coverage, which is exactly why it can
be that loud. Our `--signal-500` is `#FA500F`. Keep the coverage low and the chroma high.
Inverting that — lots of a muted orange — is how this palette dies.

**3. Elevation is lightness. Always, in both modes.**
Panels, popovers and menus get *lighter* as they come forward, in dark mode as well as
light. No mode inverts the rule. Shadows are barely present; a hairline border and a step
in surface lightness do the work. Users learn one mental model and it holds everywhere.

**4. Type is small, tight, and entirely sans.**
No editorial serif, no display face. Default UI text is 13px with slightly negative
tracking on anything above 18px. The personality comes from density and restraint, not
from a characterful face. This is what makes it feel engineered rather than published.

**5. Chrome is quiet so one element can be loud.**
In Le Chat that element is the composer — big radius, inset well, everything else recedes
around it. The whole layout is arranged so your eye has exactly one place to go.

---

## Where Precipice extends the system rather than copying it

Two deliberate additions. Both are ours, both are justified by the fact that this is a
builder's canvas and not a chat window.

### Monospace as a semantic tier

Mono is reserved, strictly, for **machine truth**: object ids, action names, model and
provider names, timestamps, type labels, keybindings. Never prose, never headings, never
decoration.

The payoff is that the interface becomes self-documenting. When a user sees
`CreateObject` in mono next to a node, they learn that actions are real, nameable,
inspectable things — which is precisely the mental model the Action Protocol depends on.
The type system teaches the architecture. That's structure encoding something true rather
than decorating.

### The generation ribbon — the signature element

When AI generates, Precipice does not show a spinner and then a finished canvas.

A thin ribbon docks above the composer. Each action appears in it as it lands — mono,
one line, `CreateObject · journey · "Verify identity"` — while the corresponding node
scales in on the canvas from `0.96` with a single soft spring, and its edges draw in
after a 60ms beat. The ribbon fills left to right as the transaction completes.

When it's done the ribbon collapses to one line: `18 actions · claude-sonnet-4-6 · undo`.
That undo reverses the whole transaction, because every action carries the same `txId`.

This is the moment the product is remembered by, and it's the moment the architecture is
visible: reasoning arrives as discrete, named, reversible operations. Spend the animation
budget here. Everything else in the app stays still.

---

## Colour

### Neutrals — "Ash"

A warm ramp at ~35° hue, low chroma. This is 90% of every screen.

`#FCFBF9` · `#F7F5F1` · `#F0EDE7` · `#E7E3DB` · `#DCD7CD` · `#C4BDB0` · `#9E958A`
· `#786F63` · `#5A5248` · `#423C34` · `#2B2721` · `#1E1B17` · `#141210`

### Accent — "Signal"

`#FA500F` at rest in light mode; `#FF7033` in dark mode.

The accent **shifts lighter and slightly less saturated in dark mode**. A colour tuned for
contrast against paper will vibrate against near-black. This is the same adjustment
Mistral makes and it is not optional.

Accent is for: primary buttons, focus rings, the active generation state, selection
outlines on canvas, and the Risk object type. That's the complete list.

### Brand gradient

A five-step gold → red ramp, an homage to Mistral's stepped logo treatment. Permitted in
exactly two places: the empty-canvas mark, and the app icon. Never on buttons, never as a
text fill, never as a card background. When Precipice has its own identity, replace the
steps — the *structure* (discrete steps, not a smooth blend) is the borrowed idea, and
that's the part worth keeping.

### Object type hues

Muted enough to sit together on one canvas without turning it into a highlighter accident.
Every one is warm-compatible.

| Type | Light | Dark |
|---|---|---|
| Note | neutral | neutral |
| Journey | `#4E8C86` dusty teal | `#6FB3AC` |
| Wireframe | `#5B6BAE` dusty indigo | `#8794D4` |
| *Persona* (reserved) | `#A85F5A` clay rose | `#C98A85` |
| *Metric* (reserved) | `#6E8C3F` olive | `#96B368` |
| *Risk* (reserved) | shares `--signal` | shares `--signal` |

Risk sharing the accent is intentional. Risk *is* the thing that should catch your eye.

### Status

Success, danger and info are desaturated to sit in the warm palette. Danger is pushed
toward crimson (`#C33A2E`) specifically so it is not confusable with the orange accent at
small sizes.

**Warning is a problem.** In a palette where the accent is orange, an amber warning state
is nearly invisible. A token exists, but prefer resolving warnings through copy and an
icon rather than colour. If you find yourself reaching for it often, the interface is
probably warning too much.

---

## Type

- **UI and prose:** Inter Variable. Enable `cv05`, `cv11`, `ss03`, and optical sizing.
- **Machine truth:** JetBrains Mono, 500 weight, uppercase with `+0.04em` tracking for
  labels.
- No third face. The restraint is the point.

| Token | Size / line | Tracking | Use |
|---|---|---|---|
| `2xs` | 11 / 16 | +0.04em | mono labels, uppercase |
| `xs` | 12 / 18 | 0 | metadata, timestamps, captions |
| `sm` | **13 / 20** | 0 | **default UI text** |
| `base` | 15 / 24 | 0 | prose inside objects |
| `lg` | 17 / 26 | −0.008em | panel titles |
| `xl` | 20 / 28 | −0.014em | section headings |
| `2xl` | 26 / 32 | −0.020em | scape titles |
| `3xl` | 34 / 40 | −0.024em | empty states |

Weights: 400 body, 500 UI default, 600 emphasis. 700 appears nowhere.

---

## Light and dark

Three settings — System, Light, Dark — matching how Mistral handles it. Applied as a
`dark` class on `<html>` plus `color-scheme`, set by an inline script in `index.html`
before first paint. A flash of the wrong theme is a bug, not a nitpick.

### The rules that make dark mode not look like an inversion

1. **Elevation is lighter in both modes.** Canvas → base → surface → raised, always
   ascending in lightness.
2. **The canvas is deeper than the panels sitting on it.** In light mode the canvas is
   `#F0EDE7` while cards are `#FCFBF9`. The canvas is the table; nodes are paper on it.
   This is the one place lightness *descends*, and it's what makes nodes read as objects.
3. **Borders are alpha, never hex.** `rgba(30,27,23,0.10)` in light,
   `rgba(237,233,225,0.12)` in dark. Alpha borders composite correctly over any surface;
   hex borders break the moment something moves to a different elevation.
4. **Never pure black, never pure white.** `#1E1B17` and `#EDE9E1`. Pure white on near-black
   haloes badly at 13px.
5. **Text contrast drops in dark mode.** Secondary text moves further from primary than it
   does in light. Dark interfaces read as higher-contrast than they measure.
6. **Shadows nearly vanish in dark mode.** Depth comes from the surface step and the
   hairline. A heavy shadow on a dark surface just looks like dirt.
7. **The accent lightens.** `#FA500F` → `#FF7033`.

---

## Geometry and motion

**Radii:** 4 / 6 / 8 / 12 / 16 / 20 / full.
Buttons 8. Node cards 12. Composer 20. Chips full. Inspector flush to the viewport edge,
no radius on the outer corner.

**Spacing:** 4pt base. Panel padding 16. Canvas node padding 12/14. Composer padding 12/16.

**Motion:**

| Token | Duration | Use |
|---|---|---|
| `instant` | 80ms | hover, press |
| `fast` | 130ms | chips, toggles, tooltips |
| `base` | 190ms | panels, menus, toasts |
| `slow` | 280ms | inspector slide, sidebar collapse |
| `canvas` | 420ms | fly-to, auto-layout reflow |

Easing is `--ease-out` — `cubic-bezier(0.16, 1, 0.3, 1)` — quick departure, gentle
settle. No bounce anywhere in chrome. The single permitted spring is node entry during
generation, and it's subtle.

Under `prefers-reduced-motion`, durations collapse to `1ms` and the node entry becomes a
plain opacity fade. The generation ribbon still updates — it's information, not decoration.

---

## Component notes

**Composer.** Docked bottom-centre, floating over the canvas, `max-width: 720px`. Inset
well background, 20px radius, hairline border that shifts to `--border-focus` on focus.
Icon row along the bottom inside the well: scope selector, model picker, attach. Send is a
filled circular button in `--accent`, disabled to `--bg-inset` when empty. This is the
loudest element on screen and everything else is arranged to make that true.

**Sidebar.** Collapsible, `--bg-base`, no border on the canvas side — the surface step
alone separates it. Scape rows are 32px tall, 13px text, radius 6, hover to `--bg-hover`.
Active row gets `--bg-selected` and a 2px `--accent` bar inset on the left.

**Node card.** `--bg-surface`, radius 12, `--shadow-sm`. A 2px type-coloured bar along the
top edge is the only colour. Title 13/500, body 12/400 `--text-secondary`, id in mono
`2xs` `--text-tertiary` at the bottom. Selected state is a 2px `--accent` ring at
`--r-lg`, no shadow change.

**Inspector.** Slides from the right at `--dur-slow`, 320px, `--bg-surface`, hairline on
the leading edge only. Section headers are mono `2xs` uppercase `--text-tertiary`.
Fields are `--bg-inset`, radius 8, focus ring `--accent` at 40%.

**Empty scape.** The brand mark, one line at `3xl`, and three suggestion chips —
*User journey*, *Personas*, *Architecture*. Chips are `--bg-surface`, full radius, 13px,
hover lifts to `--bg-raised`. An empty screen is an invitation to act, so the copy is an
instruction, not a greeting.

---

## Quality floor

Non-negotiable, and not worth announcing in the UI:

- Every interactive element has a visible keyboard focus ring — 2px `--accent` at 45%
  plus a 1px inner ring in `--bg-base` so it reads on any surface.
- Body text meets 4.5:1, large text 3:1, in both modes. The token pairs are chosen to
  pass; if you compose your own pair, check it.
- `prefers-reduced-motion` respected.
- The canvas is keyboard-navigable: tab between nodes, enter to open the inspector,
  arrow keys to move the selection.
- Nothing conveys meaning through colour alone. Object type has a hue *and* a label.
