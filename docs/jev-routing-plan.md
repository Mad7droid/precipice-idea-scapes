# Jev routing plan

Status: original research proposal, 2026-10-21. The [combined voice and routing plan](voice-and-routing-plan.md) supersedes this proposal for implementation and rollout. Routing code is now present behind opt-in settings; live evaluation and hardware acceptance remain pending. Jev is a decision model that
reads a request and decides how Precipice should handle it, then hands the work to the Claude
model that fits. It never writes anything on the canvas.

## What Jev is (and is not)

Jev (TypeSafe AI, launched 2026-09-15) is a "System One" model. It takes a `state` (text or
JSON) and named typed questions, and it returns only typed answers:

| Primitive | Returns                                    | Precipice use                         |
| --------- | ------------------------------------------ | ------------------------------------- |
| `choice`  | one of 1–255 declared options + confidence | intent, voice command, object type    |
| `score`   | expected level on a 1–10 level rubric      | how deep the request is → model tier  |
| `noul`    | yes/no probability 0–1                     | "about the selection?", "needs web?"  |
| `box`     | image region (vision, opt-in header)       | later: "this one" on a canvas capture |

- `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer`, model `jev-latest`.
  JS SDK `@typesafe-ai/sdk` (Node 22+; browser/CORS support is undocumented).
- The vendor reports 70–500 ms latency (median about 0.45 s) and $0.042 per million input
  tokens, with output free. All questions in one call are evaluated in parallel against the
  same state, so asking six costs about the same as asking one.
- **It does not generate text, code or objects.** Its documented weak spots are counting,
  arithmetic, dates, multi-hop or negated instructions, large irrelevant state, a bias toward
  options listed earlier, and adversarial content.
- Its confidence values are reported to be well calibrated, which is the property that makes
  routing safe (see [confidence routing](https://docs.typesafe.ai/patterns/confidence-routing.md)).
- Data: the vendor says it does not train on customer data. Retention is covered by its DPA,
  and no-retention terms are enterprise only. Treat it as a new third-party processor.

So the premise "Jev makes, Claude enhances" becomes **Jev decides, Claude makes, Opus
deepens.** Jev's speed helps because Precipice stops making you choose a mode, scope, types
and model before every send. Faster generation itself comes from the tier it picks.

## Where routing happens today (all manual)

| Decision          | Today                                  | Source                       |
| ----------------- | -------------------------------------- | ---------------------------- |
| Ask vs Edit       | segmented toggle in the composer       | `src/ai/Composer.tsx`        |
| Scape vs selected | scope control                          | `src/ai/prompt.ts` (`Scope`) |
| Object types      | types control                          | `Composer.tsx` `showTypes`   |
| Model             | model picker, default Sonnet 5         | `src/ai/models.ts`           |
| Web search        | Ask-only toggle                        | `useScapi.ts`                |
| Connect mode      | separate generation mode               | `GenerationMode`             |
| Voice             | dictation fills the draft, never sends | `src/dictation/`             |

Each one is a small decision with a few options. That is exactly the kind of question Jev
answers.

## The roles

| Role                  | Engine                              | When                                                        |
| --------------------- | ----------------------------------- | ----------------------------------------------------------- |
| **Decide**            | Jev                                 | every draft pause, every dictated phrase, ~0.4 s, ~free     |
| **Do instantly**      | local command via `applyAction`     | voice/text commands: undo, focus, select, zoom, connect A→B |
| **Make fast**         | Haiku 5.5 (new) / Sonnet 5.5        | small edits, single objects, standard briefs                |
| **Make well**         | Opus 5.5                            | multi-part or ambiguous briefs, and the "Deepen" pass       |
| **Answer**            | Scapi (Sonnet/Opus, read-only, web) | questions about the scape or the world                      |
| **Long-running work** | an external agent via MCP           | hand-off only; Precipice does not call MCP, agents call it  |

MCP points the other way: Claude Desktop, Claude Code or another agent connects _to_
Precipice and works through `preview_flow`/`apply_changes`. It is not a model Precipice
can route to. The most routing can do is offer "Continue in Claude" for work that needs many
files, the web or long autonomy.

## One Jev call per draft

`state` is the request plus a compact, content-light context. Questions run in parallel:

```ts
// src/ai/router/questions.ts (proposed)
state: {
  request,                      // typed or dictated text
  input: "typed" | "voice",
  selection: { count, types },  // types and titles only, never bodies
  scape: { objectCount, types, starter },
},
questions: {
  intent:  choice({ edit, ask, connect, command }),          // default listed first (order bias)
  aboutSelection: noul(),                                     // only when selection.count > 0
  depth:   score([tweak, single object, standard flow, multi-part or ambiguous]),
  web:     noul("needs current information from outside this scape"),
  wantsJourney / wantsWireframe / wantsNote / wantsBlock: noul(),
  command: choice({ none, undo, focus, select, zoom_to, connect, rename }),  // short inputs only
}
```

Code makes the final decision, not Jev:

```ts
interface RouteDecision {
  intent: "ask" | "edit" | "connect" | "command";
  scope: Scope;
  types: ObjectType[] | undefined;
  modelId: string; // from depth: tweak → Haiku, 1–2 → Sonnet, 3 → Sonnet + offer Deepen
  webSearch: boolean; // only ever true when intent === "ask"
  command?: LocalCommand;
  confidence: number; // min over the questions that decided this route
  source: "jev" | "heuristic" | "manual";
}
```

Invariants (tested):

1. **The capability boundary holds.** A route never combines web search with write tools.
   Ask stays read-only, as `scapiTools.ts` requires, so a hostile page still cannot edit the
   document.
2. **Mutations go through `applyAction`**, including local commands. Each generation keeps
   one `txId`, so one undo reverses it.
3. **Routing never blocks.** Jev times out at 800 ms, or is missing, offline or unconfigured →
   fall back to local heuristics, then to the user's last manual choice. Sending never waits on Jev.
4. **Manual always wins.** A user override sticks for the rest of that draft. A per-scape
   override counter (counts only, never text) can raise the confidence thresholds later.
5. **Jev never sees** object bodies, web results, API keys or the library. Titles and types
   are enough, and less irrelevant state also improves its accuracy.

## UX: one composer, intent shown, never asked

The Ask/Edit toggle, scope control, types control and model picker merge into one row of
**route chips** that fill in while you type or speak:

```
┌───────────────────────────────────────────────────────────────┐
│ add a checkout wireframe after the cart step and link them    │
│                                                               │
│ [ Edit ▾ ] [ 2 selected ▾ ] [ Wireframe ▾ ] [ Sonnet ▾ ]  🎙  ➤ │
└───────────────────────────────────────────────────────────────┘
```

- **Speculative.** Jev runs about 500 ms after typing pauses and after each dictated phrase,
  so the chips are already settled when you press Cmd+Enter. The request costs nothing extra.
- **Confidence-gated**, using the vendor's documented pattern:
  - ≥ 0.85: chip shown plainly; send uses it.
  - 0.6–0.85: chip gets the existing focus ring with a one-word alternative ("Edit · or Ask?").
    One click or Tab switches it. Send still works.
  - < 0.6: chips show your last manual choice, as Precipice works today.
- **Chips are the controls.** Clicking one opens the same menu as today's control. Nothing
  else is hidden, and a route can always be changed before sending.
- **No mode jump on send.** If the route is Ask, the draft goes to the Scapi panel. If it is
  Edit, it goes to the canvas generation stream. The chip already said which, so nothing
  surprises.
- **Deepen.** After a generation finishes, the existing done chip ("Added 6 · Undo") gets
  **Deepen with Opus**, emphasised when `depth` scored 3. Deepen is a second transaction
  scoped to the objects just created, so its own undo removes only the refinement. This is
  "make fast, then enhance" without paying Opus prices on every send.

### Voice

Keep every dictation rule in [dictation UX research](dictation-ux-research.md): review
before send, no auto-submit, Esc cancels. Routing adds one thing:

- When a short utterance ends and Jev returns `intent: command` with high confidence, the
  draft shows a **command chip** in place of a send: `↩ Undo last generation  ⏎`.
  - **Non-destructive commands** (focus, select, zoom to) run on Enter, or immediately at
    ≥ 0.9 confidence. Their worst case is a moved viewport.
  - **Commands that change the scape** (undo, connect, rename) always need Enter. Delete is
    not a voice command.
  - Either way the dictated text remains in the draft, so dismissing the chip leaves an
    ordinary request.
- Longer dictation flows into the route chips exactly like typing does. Voice becomes the
  fastest way to set a route, because the chips update after each pause.
- Hindi and Hinglish: Jev reads the transcript, which is text. Accuracy on Hinglish
  intent is unknown and is part of the eval below.
- Later, a conversational voice mode where Scapi speaks is a separate decision. Routing
  works the same whether or not that exists.

## Architecture

```
src/ai/router/
  questions.ts     Jev question set + state projection (titles/types only)
  decide.ts        pure: Jev answers + heuristics + overrides → RouteDecision
  heuristics.ts    zero-latency fallback ("?" → ask, selection + "this" → selection, …)
  jev.ts           transport: desktop direct; web via the existing proxy Worker
  useRoute.ts      debounced, abortable, one in flight per composer
  commands.ts      LocalCommand → applyAction / viewport, with the confirm policy
  router.test.ts   invariants above + table-driven decisions
src/ai/models.ts   + Haiku 5.5 ("Instant. Small edits and single objects.")
```

- **Key**: a TypeSafe key, stored the same way as the Anthropic key. That means tab-session
  storage on the web and Keychain through the restricted Tauri commands on desktop. Never put
  it in files, IndexedDB or logs.
- **Transport**: browser CORS is undocumented, so the web build adds a `/typesafe/v1/systemone`
  pass-through to the existing BYOK proxy Worker. Desktop calls the API directly. Neither
  build uses a managed key.
- **Opt-in**: Settings → "Smart routing (TypeSafe Jev)". It is off by default, with one line
  stating what is sent. Without it Precipice runs on heuristics, so the chips still work.
- **Docs to update when built**: `security-and-local-data.md` (a new processor, the exact
  projection), `codebase-architecture.md`, `CHANGELOG.md`, and the Scapi UX reference.

## Phases

| Phase             | Work                                                                                                                            | Gate to continue                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 0 · eval (1 d)    | 100 fictional, labelled requests (typed, dictated, Hinglish) in `src/ai/evals.ts`. Compare heuristics, Jev, and Haiku-as-router | Jev intent ≥ 90 % at ≥ 0.85 confidence, p95 < 600 ms; clearly better than heuristics |
| 1 · chips (3–4 d) | `router/`, heuristics, route chips replacing the toggle/scope/types/model controls, overrides                                   | No regression in `pnpm verify`; manual-only path identical to today                  |
| 2 · tiers (2–3 d) | Haiku 5.5, depth → model, Deepen with Opus as a scoped second transaction                                                       | Median time-to-first-object drops on tweak/single-object requests                    |
| 3 · voice (3 d)   | command lane, confirm policy, chip after a dictated pause                                                                       | Hardware test with English + Hindi; no command runs without its confirm rule         |
| 4 · later         | "Continue in Claude" MCP hand-off; `box` for "this one" on a canvas capture                                                     | Only if phases 1–3 are used                                                          |

Heuristics ship first and alone if phase 0 fails. The chip UX is worth having without Jev;
Jev makes it right more often.

## Risks

- **Vendor maturity.** The model launched five weeks ago, it is closed source, and its API
  was overloaded at launch. Mitigation: the timeout and fallback make Jev purely additive.
- **Wrong route on send.** Mitigation: chips are visible before send, there is one undo per
  transaction, and below 0.85 confidence the chip offers the alternative.
- **Disclosure.** Request text leaves the device for a second vendor. Mitigation: opt-in
  setting, minimal projection, documented in the security guide.
- **Over-automation.** Removing the toggle may hide the Ask/Edit distinction that keeps
  Scapi read-only. The chip names it on every draft. That boundary is enforced in code, not
  by Jev.

Sources: [TypeSafe docs](https://docs.typesafe.ai/llms.txt),
[System One API](https://docs.typesafe.ai/api/system-one.md),
[Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md),
[Crypto Briefing](https://cryptobriefing.com/jev-ai-model-faster-cheaper-alternative/),
[Futura-Sciences](https://www.futura-sciences.com/en/?p=900220),
[OpenRouter listing](https://openrouter.ai/models/typesafe/jev-1.14).
