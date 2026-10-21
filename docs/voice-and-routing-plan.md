# Voice and routing: combined plan

Status: implementation in progress, 2026-10-21. This is the controlling combined plan.
Local routing, optional Jev transport/credentials, tier selection, Deepen and confirmed
commands are implemented behind opt-in settings. Dictation interaction hardening is also
implemented. Live routing evaluation, native hardware checks, performance measurements,
the per-composer draft store and web dictation remain outstanding. The meter now subscribes
through its own level signal, so audio ticks do not re-render the composer. Neither routing setting
is enabled by default; the Jev quality gate has **not** been passed.

## One pipeline

```
 type ─┐                         ┌─ local heuristics (always, 0 ms, free)
       ├─► draft ─► route ───────┤
 speak ┘  (local    (debounced)  └─ Jev (opt-in, ~0.4 s, text only)
  Whisper)              │
                        ▼
              route chips in the composer  ──► ⌘↵ ──► Claude tier ──► done chip
              (visible, editable, never auto-sends)                   Undo · Deepen with Opus
```

Dictation produces text and routing reads text, so voice needs no routing path of its own.
The only voice-specific addition is the command lane (phase F).

## Decisions

| Topic           | Decision                                                                                                                                               | Why                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Router default  | Local heuristics, always on                                                                                                                            | Keeps "fully local, free"; chips work offline and without a key              |
| Jev             | Opt-in enhancer behind the eval gate, off by default                                                                                                   | It is a new third-party processor; must be measurably better than heuristics |
| Jev transport   | Plain `fetch` + existing `zod`; no `@typesafe-ai/sdk`                                                                                                  | No new dependency; the SDK targets Node 22+                                  |
| Jev input       | Draft text + types/counts/titles only, never bodies, audio, keys or library                                                                            | Disclosure and Jev accuracy both improve with less state                     |
| Audio           | Never leaves the Mac; Jev only ever sees the transcript the person can already see                                                                     | The dictation privacy promise stays literal                                  |
| Fast model tier | Haiku 5.5 (`claude-haiku-5-5`), confirmed against the current Anthropic model catalogue | Confirm the id in `models.ts` before shipping                                |
| Manual controls | Become the chips, same menus; nothing removed                                                                                                          | Override is always one click; no capability is hidden                        |
| Rollout         | `routeChips` setting, off until phase C passes; manual-only path must be byte-for-byte today's behaviour                                               | No regression for people who never opt in                                    |
| Sending         | Only on ⌘↵ or Send. Neither dictation nor routing ever submits                                                                                         | One rule across both plans                                                   |
| Voice commands  | Always need Enter in v1, including viewport ones                                                                                                       | Same "never acts on its own" rule; earn auto-run later with data             |

## UX and UI

### Composer anatomy (both the canvas composer and the Scapi panel)

```
┌──────────────────────────────────────────────────────────────────────┐
│ add a checkout wireframe after the cart step and link them           │
│                                                                      │
│ [Edit → canvas ▾] [2 selected ▾] [Wireframe ▾] [Sonnet ▾]    🎙   ➤  │
└──────────────────────────────────────────────────────────────────────┘
```

- Chips sit where today's Ask/Edit toggle, scope, types and model controls sit; each opens
  the same menu as today. The intent chip names its destination ("Ask → Scapi",
  "Edit → canvas") so a send never lands somewhere unexpected.
- Mic and Send stay at the right, in that order, as built today.

### States

| State                | Chips                                                    | Mic area                                  | Send                                         |
| -------------------- | -------------------------------------------------------- | ----------------------------------------- | -------------------------------------------- |
| Empty                | last manual choice, quiet                                | mic                                       | disabled                                     |
| Typing / paused      | settle ~500 ms after the pause                           | mic                                       | enabled                                      |
| Listening            | update after each phrase                                 | level meter · timer · ✕ cancel · ✓ finish | disabled                                     |
| Finishing            | final update                                             | "Finishing…"                              | disabled                                     |
| Confident (≥ 0.85)   | plain                                                    | —                                         | uses the route                               |
| Unsure (0.6–0.85)    | focus ring + "or Ask?" alternative, one click to swap    | —                                         | uses shown route                             |
| Low (< 0.6) / no Jev | last manual choice, exactly as today                     | —                                         | as today                                     |
| Command recognised   | replaced by one command chip: `↩ Undo last generation ⏎` | —                                         | Enter runs command                           |
| After generation     | —                                                        | —                                         | done chip: Added 6 · Undo · Deepen with Opus |

### Voice flow

1. Click the mic or press ⌘⇧Space in the field. First use asks for the model download, then
   the mic permission.
2. Speak. Each phrase lands in the draft as you pause; chips update with it, so by the time
   you stop the route is already settled.
3. Click ✓ or press ⌘⇧Space to finish; Esc or ✕ discards pending audio and keeps text.
4. Edit if needed, check the chips, press ⌘↵.
5. A short utterance such as "undo that" or "zoom to roadmap" shows a command chip instead;
   Enter runs it, typing anything turns it back into an ordinary draft.

### Interaction rules

- Swap a chip by clicking it, or Tab to it and press Enter/arrow keys. Do **not** repurpose
  Tab to cycle alternatives (the Jev plan suggested this): it breaks focus order for keyboard
  and screen-reader users.
- Chips never move while the pointer is over them or a chip menu is open; a route update
  that arrives then is held until the pointer leaves. Prevents mis-clicks on shifting UI.
- A manual chip change sticks for the rest of that draft; routing stops touching that chip.
- Delete is never a voice command. Commands that change the scape always show what they
  will do before Enter.
- Language stays in Settings; Hinglish is routed from its transcript like any other text.

## System design: light and hard to break

### Code layout

```
src/dictation/        built: engine contract, hook, mic button (desktop engine)
src/ai/router/
  heuristics.ts       pure, tiny, in the main chunk
  decide.ts           pure: answers + heuristics + overrides → RouteDecision
  jev.ts              lazy-imported only after opt-in
  useRoute.ts         debounce, abort, cache
  commands.ts         LocalCommand → applyAction / viewport
src/ai/draft.ts       per-composer draft store (text, source, route, dictation state)
```

### Performance budget

| Item           | Budget / rule                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main JS chunk  | +5 KB max for chips + heuristics; Jev client and web Whisper are dynamic imports; CI size check                                                                           |
| Re-renders     | Per-composer zustand draft store with selectors: textarea, chips, mic and meter subscribe to slices. Level updates re-render only the meter                               |
| Jev calls      | Only after a 500 ms pause or a dictated phrase; ≥ 3 words; skip if normalized text unchanged; one in flight per composer, earlier aborted; 20-entry cache; 800 ms timeout |
| Sending        | Never waits on routing; uses whatever route is visible                                                                                                                    |
| Mac binary     | +3.1 MB today; claw back with `strip` + thin LTO                                                                                                                          |
| Memory at rest | Unchanged from 0.1.9: no model loaded, no worker, no mic until pressed                                                                                                    |

### Bug-resistance

- `decide.ts` and `heuristics.ts` are pure and table-tested from the shared eval set.
- Invariants from the Jev plan stay as tests: web search never combines with write tools;
  every mutation goes through `applyAction` with one `txId`; routing failures are invisible.
- Dictation and routing share one rule set for ownership and cancellation: a composer
  unmounting mid-dictation or mid-route cancels both, tested.
- Feature flag plus "manual path unchanged" snapshot tests make each phase revertible.

## Phases (one sequence for both plans)

| Phase                           | Work                                                                                                                           | Days | Gate                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------ |
| A · dictation hardening         | the [phase 1.5 list](dictation-plan.md): meter isolation, preload on focus, ring buffer, unplug handling, queue cap, strip/LTO | 2–3  | No composer re-render while listening; idle RSS unchanged                                        |
| B · draft store + chips (local) | `draft.ts`, heuristics, chips replacing the four controls behind `routeChips`                                                  | 3–4  | `pnpm verify` green; manual path identical                                                       |
| C · eval                        | 100 fictional labelled requests: typed, dictated (real voice), Hindi, Hinglish. Heuristics vs Jev vs Haiku-as-router           | 1–2  | Jev ≥ 90 % intent at ≥ 0.85 confidence, p95 < 600 ms, clearly beats heuristics. Otherwise skip D |
| D · Jev opt-in                  | key storage like the Anthropic key, proxy pass-through for web, Settings toggle, security doc                                  | 2    | Disclosure documented; off by default                                                            |
| E · tiers + Deepen              | Haiku tier from `depth`, Deepen as a scoped second transaction                                                                 | 2–3  | Faster time-to-first-object on small requests                                                    |
| F · voice command lane          | command chip, confirm rule, local commands                                                                                     | 2–3  | Real-voice English + Hindi test; nothing runs without Enter                                      |
| G · web dictation               | lazy worker engine, R2 models, CSP                                                                                             | 4–6  | Main chunk budget held                                                                           |
| H · later                       | Malayalam pack, mobile, MCP hand-off, `box`                                                                                    | —    | Only after use                                                                                   |

Total A–G: about 16–23 days. A and B are worth shipping even if Jev never passes C.

## Open items for the person deciding

1. Haiku 5.5 id verified against [Anthropic models](https://platform.claude.com/docs/en/models/overview) on 2026-10-21; live account access and latency remain untested.
2. The Jev vendor facts in the routing plan (pricing, latency, calibration, DPA) come from its
   docs and press; verify them before phase D, and decide whether a second processor fits the
   local-first promise at all.
3. Real-voice recordings for phase C are personal data: keep them out of Git (`.context/`).

## Development preview and evaluation

Start the updated BYOK relay with `pnpm exec wrangler dev --local --port 8787 --ip 127.0.0.1`,
then run `VITE_AI_PROXY_URL=http://127.0.0.1:8787 pnpm dev --host 127.0.0.1 --port 5173 --strictPort`.
Open http://127.0.0.1:5173/ and enable local suggestions in Settings → AI. No key is needed
for route chips or local viewport/undo commands. Anthropic is needed for generation,
questions, connecting with AI and Deepen. Jev needs a separate TypeSafe key. Browser
voice capture is not implemented; dictation still requires the Mac app.

`node scripts/eval-routing.mjs` reports the local baseline without network calls. The
100 synthetic requests use 25 wording patterns across four fictional subjects; they include
Hinglish text but are not speech-recognition QA or an independent holdout. The first local
run scored 88/100 intent matches, with 8 high-confidence predictions (all correct). Remaining
misses include polite creation requests and subject-first Hinglish. Always review the route.

For the live gate, put `TYPESAFE_API_KEY` in the gitignored `.env.routing.local`, then run:

```sh
node --env-file=.env.routing.local scripts/eval-routing.mjs --live
```

This makes 100 paid TypeSafe requests containing only fictional prompts and metadata. Reports
contain aggregate measurements and scenario ids, never credentials. Timeouts and failed calls
count as misses and contribute their elapsed time to p95. The script exits unsuccessfully if
Jev does not beat the baseline, achieve 90% accuracy among confident predictions, or stay
below 600 ms p95. Report coverage alongside accuracy; a small confident subset is weak evidence.
Haiku-as-router comparison, broader holdout data and real English/Hindi/Hinglish hardware QA
remain pending. Passing this synthetic gate alone does not enable Jev by default.

Native validation on 2026-10-21: `cargo check` passed; `cargo test` passed 15 tests
with 2 model-dependent tests ignored. CMake 3.31.10 is installed only under the ignored
`.context/build-tools` venv. For this workspace, prefix Cargo commands with
`CMAKE="$PWD/.context/build-tools/bin/cmake"`. This does not validate actual microphone
permissions, dictation accuracy, signed packaging or English/Hindi hardware behavior.
