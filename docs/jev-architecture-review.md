# Jev and live voice: architecture review

Review draft · 22 October 2026 · source tree version 0.1.13.

This document describes the checked-out implementation, including an unfinished local
change in `src/ai/router/jev.ts`. It does not certify what is installed or deployed.
Use this as the editable review document; the older routing plans describe earlier designs
and disagree with the implementation in several places.

## The central distinction

**Jev decides how to handle a request. The selected Claude or ChatGPT model answers it or
changes the canvas. Speech recognition supplies the words.** These are separate stages,
with separate failure modes and timing.

Jev is not the speech recogniser, a conversational memory, or the canvas generator.
“Use only Jev” can mean routing without local heuristics. It cannot replace the model
that writes an answer or generates edits in the present architecture.

## Current pipeline

```text
Typed draft ───────────────────────┐
Microphone → local speech → text ──┤
                                  ▼
                       Composer / live phrase queue
                                  │
                     local heuristic suggestion
                                  +
                     optional TypeSafe Jev request
                                  │
                  merge suggestions per dimension
                                  │
                   confidence rules + manual baseline
                                  ▼
                  Ask / Edit / Connect / local command
                    │        │                │
              read-only   generation       app action
              assistant   + validation      or viewport
                             │
                       undoable changes
```

Normal dictation fills a draft and needs Send. Live explicitly enables automatic execution
after recognised phrases; it does not execute every interim word. Live requests run serially,
although routing the next phrase can overlap the current generation.

## What Jev can decide in this app

| Dimension | Present capability | Limits |
| --- | --- | --- |
| Intent | Ask, Edit, Connect, command | Classification, not execution |
| Scope | Selection or whole scape | Selection question only exists with a selection |
| Object types | Restrict creation to offered plugin types | Positive probability ≥ 0.8; current parser only emits a restriction when fewer than all returned type answers are positive |
| Work depth | Suggest instant or standard tier; flag a large request for Deepen | Does not automatically promote work to Opus |
| Web search | Suggest whether an Ask needs outside information | Disabled for write routes by application code |
| App command | Undo, redo, focus, select-all, fit, connect | Only offered when commands are supported and input is at most eight words |
| Named target | Choose an object by its ID/title | At most 60 candidate objects; focus requires target confidence ≥ 0.6 |

Not implemented here: Jev-generated canvas content, audio understanding, speech output,
visual target detection, conversation memory, arbitrary tool execution, delete commands,
or autonomous external agents. MCP is a separate route by which external agents operate
Precipice; Jev does not launch or orchestrate them.

## Exactly what goes to TypeSafe

`buildRequest` sends one POST with `model: "jev-latest"`, a `state`, and named questions.

```json
{
  "model": "jev-latest",
  "state": {
    "request": "Make this shorter",
    "input": "voice",
    "selection": { "count": 1, "types": ["note"] },
    "object_types": ["note", "journey", "wireframe", "scape"]
  },
  "questions": "Typed question definitions, described below"
}
```

The example abbreviates `questions`; it is not a request fixture. The real question set is:

- `intent`: choice among permitted intents.
- `depth`: score against four descriptions, parsed as 0–3.
- `web`: probability that outside current information is needed.
- `type_<plugin>`: probability that the request explicitly asks to create that type.
- `about_selection`: selection probability, when anything is selected.
- `command`: choice of supported command or none, for short command-capable input.
- `target`: choice among none and up to 60 object IDs, with titles/types as descriptions.

Object titles are therefore transmitted in target question criteria, not in `state`.
Bodies, audio, library contents, previous live utterances, previous outputs and relationships
are not included in this routing request. The TypeSafe key travels separately as an
authentication header; it is not part of model context.

The generation/answer stage receives its own context. A small Jev payload does not imply
that the downstream model sees only this small projection.

## Transports, credentials and deadlines

| Runtime | Request path | Credentials / limits |
| --- | --- | --- |
| Web | Browser → configured AI proxy `/v1/systemone` → TypeSafe | User's key; web credentials are tab-session data. Default proxy is `precipice-ai-proxy.precipice.workers.dev`; `VITE_AI_PROXY_URL` can override it |
| Mac | Webview → Tauri `jev_route` → `https://api.typesafe.ai/v1/systemone` | Native command reads Keychain; HTTPS only, no redirects, request ≤ 64 KiB, response ≤ 256 KiB |

The active callers still use `askJev`, which has an **800 ms deadline**. Desktop native HTTP
has a separate **2,000 ms deadline**. A frontend timeout stops waiting; it does not cancel
the already dispatched native request. Browser fetch receives an abort signal.

The unfinished local refactor adds `requestJev`, structured failure reasons and a
`JEV_ONLY_TIMEOUT_MS = 4000` constant. **No settings control or live/draft caller currently
uses that constant to implement Jev-only routing.** Increasing the frontend deadline alone
would still leave native HTTP capped at two seconds.

Current `askJev` returns null on failure, hiding the difference between timeout, bad key,
network error and unusable response. The refactor distinguishes several causes, but native
HTTP refusal messages remain generic. Neither real service latency nor the user's reported
timeout cause has been established by this source inspection.

## How decisions actually win

1. Local rules produce a suggestion immediately.
2. Jev optionally produces another suggestion.
3. `merge` chooses the higher confidence **for each dimension**; Jev wins ties.
4. `decide` applies dimensions with confidence ≥ 0.6, subject to manual locks and constraints.
5. Intent confidence from 0.6 to below 0.85 can expose a runner-up choice.

A `Jev` label currently means a Jev response participated in the merged suggestion. It does
**not** prove Jev supplied the winning intent or every field. Local intent confidence is
usually 0.75; fixed commands have 0.9. A valid Jev intent at 0.7 can therefore lose to a
keyword rule. This is an architectural reason to offer genuine Jev-only routing.

Missing or low-confidence answers retain the manual baseline. Empty selection forces scape
scope. Ask cannot gain write tools through routing; write routes cannot gain web search.
Automatic tier changes only select the instant tier; standard/deep selections are not a
general automatic escalation ladder. `chatgpt/` model IDs retain their chosen model.

Normal drafts lock manually changed dimensions until the draft becomes empty. Live calls
`decide` with an empty lock set, so those draft locks are not applied to live phrases.

## Draft routing versus live routing

| Behaviour | Draft | Live |
| --- | --- | --- |
| Trigger | 500 ms typing pause; dictated draft can route immediately | Final recognised phrase |
| Jev eligibility | Key present and at least three words | Key present; no matching minimum-word gate |
| Cache | Last 20 normalised text/context combinations, including null failures | No equivalent response cache |
| Replacement | New draft aborts the prior request | Joined phrase increments a version; stale result is ignored |
| Send | Uses current decision without waiting | Waits for routing, then queue execution |
| Commands | Confirm through the normal composer interaction | Execute automatically in Live |

The live hook merges fragments into the last pending entry when it is routing/queued and
the last words arrived less than **2,100 ms** ago (`600 + 1500`). A non-command request can
start once routing is ready and at least **600 ms** have passed since its latest words.
Once an entry starts running, later words become another entry rather than revising it.
Commands bypass the 600 ms settle wait.

The hook retains six entries. This is also the runner's entry list, not just a display list:
with a large burst of speech during slow execution, older queued entries can fall out of
the list. Pending-work storage should be separated from the visible history cap.

## Why live instructions can lose their meaning

These are source-backed failure mechanisms, not a claim that any single one explains all
reported behaviour:

| Example / symptom | Mechanism | Proposed correction |
| --- | --- | --- |
| “Create a note … that explains the payment step” becomes separate edits | Silence closes a phrase; execution can start before the continuation arrives | Assemble a complete instruction before dispatch, with a bounded continuation window |
| “Put it as an output” lacks a reliable target | Jev receives current phrase and selection metadata, without previous turn/results | Keep a small live-session context: last instruction, created/changed IDs, explicit target |
| “Can you add a screen?” becomes Ask | Question-start heuristic can beat lower-confidence Jev intent | Jev-only option; test polite edit requests explicitly |
| Jev answers but UI still behaves like local rules | Confidence merge plus global `source: jev` attribution | Record the winner for each applied field |
| New phrase routes against the old canvas | Routing overlaps previous generation; context is captured before it finishes | Refresh target validity/context at dispatch |
| A simple request becomes an elaborate generation | Routing chooses a lane; downstream generation decides actual content | Add a minimal-change generation policy and a concrete change budget |
| Retry immediately falls back again | Draft cache stores failed requests | Avoid caching transient failures, or expire them quickly |

The live hook passes each entry's text to `onSend`; it does not build a conversation record
or resolve “it”, “that one”, “instead” or “no, the previous one” across live entries. Improving
the classifier alone cannot supply missing context or constrain generation scope.

## Proposed design for review — not implemented

### 1. Make routing policy explicit

Offer **Local**, **Auto (Jev + local fallback)** and **Jev only**. Keep these distinct from
the Claude/ChatGPT model selector.

In Jev-only mode, never call the heuristic merger. Wait within a measured, configurable
deadline, with matching native limits. On failure, keep the phrase and show Retry; do not
silently execute a local route. A response with missing/uncertain intent should also stay
pending rather than executing the default Edit mode. Manual routing remains an explicit
escape hatch. These semantics need agreement before implementation.

### 2. Treat speech as a continuing instruction

Use a small live-session state containing the current assembled instruction, recent
completed instruction/result IDs, selected target IDs, and pending corrections. Keep the
working queue independent of the display history. Resolve references against known IDs;
when multiple targets fit, ask one short clarification and hold that instruction.

Prefer one precise change per completed instruction. “Make it shorter” should update the
resolved object, preserve its structure and links, and avoid creating a replacement flow.
Do not let a new continuation race an already committed edit. Corrections arriving after
execution should become a new explicit correction tied to the previous transaction.

Additional context sent to Jev would change the current disclosure boundary; decide and
document the exact bounded fields before introducing it. Do not send full object bodies
merely to solve reference resolution.

### 3. Keep status compact and truthful

One persistent composer status line: `Listening`, `Understanding · Jev`,
`Editing · Claude · <model>`, or a short actionable failure. Show interim transcript in the
existing input area. Keep run history and transport details in an on-demand popover.
Separate microphone stop, pending-work cancellation and generation stop in behaviour and
labels; ending capture must have an explicit policy for queued instructions.

Show speech-finalisation, routing and execution timing separately in details. A fast route
does not mean a fast finished edit. Attribute the applied intent to its actual winning
decider, and display fallback only when fallback really occurred.

### 4. Verify meaning before claiming success

Keep the existing synthetic routing cases, but add complete spoken sequences with expected
targets and minimal canvas changes. Include continuations, corrections, polite edit
requests, English/Hindi mixtures, overlapping speech and generation, and more than six
queued phrases. Test Jev-only key rejection, timeout, malformed/low-confidence responses,
retry and desktop deadline alignment.

Measure real speech recognition errors, routing accuracy, wrong-target edits, extra objects,
lost queued phrases, and time from end of instruction to first/finished change. Mocked
transport tests cannot establish live TypeSafe speed or real microphone quality.

## Decisions to edit during review

- [ ] Default routing policy: Local / Auto / Jev only.
- [ ] Jev-only failure: hold and Retry (recommended) / another explicit action.
- [ ] Routing deadline and native deadline: choose after measuring live latency.
- [ ] Context allowed: recent text, result IDs, titles, selection; specify retention and bounds.
- [ ] Ambiguous “it/that”: clarification / selected object / last changed object, with priority.
- [ ] Small edits: specify maximum change scope and when expansion is allowed.
- [ ] Speech continuation: choose interruption and correction behaviour after execution starts.
- [ ] Stop: decide whether it cancels capture, queued work, current generation, or all three.
- [ ] UX: approve one status line with history/details on demand.
- [ ] Release gate: representative real speech and live Jev measurements on web and desktop.

## Implementation map

| Source | Responsibility |
| --- | --- |
| `src/ai/Composer.tsx` | Shared input, dictation, route controls, live entry point |
| `src/dictation/useDictation.ts` | Shared dictation session behaviour |
| `src/dictation/webEngine.ts` | Browser on-device speech recognition; requires local support |
| `src-tauri/src/` | Native speech and Keychain/HTTP boundary |
| `src/ai/router/jev.ts` | Request projection, typed parsing, transport and deadlines |
| `src/ai/router/heuristics.ts` | Local text matching and command recognition |
| `src/ai/router/decide.ts` | Confidence merge, baseline, locks and capability constraints |
| `src/ai/router/useRoute.ts` | Draft debounce, cancellation, cache and Jev status |
| `src/ai/router/types.ts` | Context, suggestion and send contracts |
| `src/ai/router/commands.ts` | Command descriptions and saved-change classification |
| `src/ai/live/useLiveVoice.ts` | Fragment joining, speculative routing and serial execution |
| `src/ai/live/LivePanel.tsx` | Recent run details |
| `src/ai/models.ts` | App model catalogue and tier mapping; not a verified provider catalogue |
| `src/ai/scapi/` | Read-only assistant and answer context |
| `src/ai/router/evals.ts` | Synthetic routing examples, not live acceptance results |

This review intentionally makes no current vendor pricing, latency, retention or model
availability claims. Those require separate verification against provider documentation.
