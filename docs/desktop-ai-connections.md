# Desktop AI connections

0.1.15. This document describes the source and its verification record. Release publication and
installation are separate steps; the checks below distinguish implemented behavior from live verification.

## Connecting Scapi

Settings → AI offers three explicit connections. The Claude plan is the default; the API key
is never chosen automatically. Only the selected connection is checked, and each remembers
its own model:

| Connection | Setup | Billing | Runtime |
| --- | --- | --- | --- |
| Claude plan | Install Claude Code; Sign in to Claude | Selected Claude plan and its limits | Local Claude Code CLI |
| ChatGPT plan | Sign in to ChatGPT; approve plan usage in the system browser | Selected ChatGPT plan and its limits | Native OAuth + Responses API |
| Anthropic API | Enter an Anthropic API key | Separate API billing | Existing Anthropic SDK transport |

Being signed in to ChatGPT Desktop or Claude Desktop does not automatically connect Scapi.
The Agents settings connect those assistants to Precipice's tools in the opposite direction.

ChatGPT shows models returned by the selected account. Saved registrations stay separate even
when their email addresses match. Adding an account does not erase existing accounts; cancel
sign-in preserves the active account. Disconnect removes the selected account's local tokens
and attempts remote refresh-token revocation. Failed revocation is disclosed; manage access
at https://chatgpt.com/settings/usage. Hosted ChatGPT plan sign-in remains unavailable.

Claude requires a current Claude Code installation supporting `--safe-mode`, `--restricted`,
`--json-schema`, and `auth status --json` (tested executable: 2.1.283). It is detected in
`~/.local/bin`, `/opt/homebrew/bin`, or `/usr/local/bin`. The sign-in button runs
`claude auth login --claudeai`; `claude auth login` in Terminal is a recovery option.
Claude manages the underlying account, so logging out or changing accounts there affects
Precipice. Each account check starts Claude Code, so requests reuse a check from the last
60 seconds and window focus re-checks at most once a minute. Precipice never copies its tokens. Sonnet, Haiku and Opus use Claude Code's model
aliases; account availability still applies. Claude plan web search is unavailable.

## Request lifecycle

Typed and spoken requests share the same paths. Jev decides intent when enabled; it does
not supply the generative model or its credentials. Ask receives read-only tools. Edit and
Connect use the existing action schemas and applier, with selection limits, object-type
validation and transaction-based undo. Deepen keeps the selected provider. Claude supplies
JSON proposals per round; ChatGPT supplies SSE Responses output. Neither can apply partial
or unvalidated tool arguments. Already-applied operations remain undoable if a later round
fails or is cancelled.

Native requests are bounded to eight concurrent operations and 180 seconds each. Stop
cancels native HTTP or drops/kills the CLI child. Account changes and screen unmounts cancel
active work. A cancelled sign-in closes its listener. There is no automatic retry of canvas
operations or switch to a differently billed provider.

## Automated verification

- Signed identity: valid RSA identity, wrong signature, issuer, audience, expiry, nonce,
  subject and not-before; callback state/client binding and required plan scope.
- Isolated account records and restoration; account/catalog binding; native cancellation
  before/after registration and concurrency limits.
- Native byte streaming across UTF-8 boundaries; incomplete streams; unsupported/repeated
  tools; authentication/quota errors; cancellation and late output.
- Real Scapi generation/applier/reducer for both connections: create note and journey,
  connect them, one-step undo, spoken context, selection enforcement and Connect restrictions.
- Real Ask with read tools and no mutations; settings restoration without API keys;
  no automatic billing fallback; sign-in cancellation and revocation recovery.
- Existing web, MCP and native regression suites, followed by the packaged app build and
  signature verification.

## Verification record and remaining checks

Recorded local verification on 22 October 2026:

- Web: `pnpm verify` passed build/type/version/Worker checks and 840 tests; the final
  regression run passed 842 tests after adding mid-stream plan-error cases. The subsequent
  disconnected-model placeholder change passed its seven settings tests and the packaged
  build's TypeScript check.
- MCP: all six bridge tests passed.
- Native: 27 regular tests passed. The opt-in disposable Keychain round-trip also passed.
- Speech: the opt-in Whisper test recognized a locally synthesized 3.2-second recording as
  “Add a note that says hello world.” Recognition took 1.45 seconds after model loading.
  This checks the real recognizer, not microphone hardware or provider latency.
- Packaged Preview: the bundle built and its ad-hoc signature verified. Its separate
  `dev.precipice.desktop.preview` identity keeps the test library apart from the installed
  app. The live Claude account was detected through native IPC, provider selection survived
  restart, and the Settings selector worked by keyboard.
- Native ChatGPT sign-in opened OpenAI's real account chooser. The owner deferred
  authorization, so the pending attempt was cancelled. No new ChatGPT account grant was
  approved. Start a fresh sign-in in Preview when ready; the earlier browser callback is
  no longer active.

The packaged check found and fixed a CLI environment bug: removing `USER`/`LOGNAME` prevented
Claude's macOS Keychain lookup. Those OS identity fields are now preserved; API keys and
provider/runtime override variables remain excluded.

The owner elected to ship the completed implementation with the following live checks still pending:

- Successful ChatGPT sign-in by the account owner, model discovery and a completed request.
- Restart and refresh behavior using a real ChatGPT grant, plus disconnect/reconnect.
- Successful Claude read and canvas-edit requests through the packaged app; the first live
  service probe returned the user's session-limit error (reset advertised as 13:30 IST).
- Packaged Settings layout and keyboard behavior, provider labels, stop/cancel and undo.
- Real spoken Ask/Edit with each provider. Scripted speech tests do not establish microphone
  quality, speech latency or routing accuracy.

The local Mac already has a pinned Whisper model. The repository currently has no
`PRECIPICE_MODELS_URL` GitHub variable. Before distributing voice to fresh installations,
configure and verify the existing model host/download path; a local model alone does not
verify first-run downloads. Existing ad-hoc desktop signing is not notarization.

## References

- [OpenAI registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [OpenAI accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [OpenAI models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Claude programmatic CLI](https://code.claude.com/docs/en/headless)
- [Claude CLI isolation flags](https://code.claude.com/docs/en/cli-reference)
- [Claude plan access](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
