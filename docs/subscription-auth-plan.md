# Subscription-first AI connection plan

Status: architecture review, before implementation. Reviewed 2026-10-21.

## Product decision

Make connecting an existing AI subscription the primary way to use Scapi across creation, Ask, Edit, and Connect. Keep Anthropic API keys and external-agent MCP connections available as secondary choices. Browsing, editing manually, importing, and exporting remain available without connecting AI.

## Corrected availability assumptions

OpenAI documents ChatGPT plan usage for open-source and locally hosted apps. Remotely hosted or paid services must pursue the separate access path. An open-source repository alone does not establish approval for a centrally hosted inference service. Identity sign-in alone does not grant inference permission. Access must be established for the actual deployment before enabling the primary hosted sign-in action.

The official open-source flow supports direct Responses requests; running Codex app-server is optional. Precipice already owns its tool loop and canvas operations, so direct Responses integration is the preferred ChatGPT adapter. Spawning a coding harness merely to generate canvas actions adds unnecessary process and deployment complexity.

Claude Code is a separate local execution integration. Do not describe Claude subscription OAuth as a general hosted Anthropic API credential. Verify the supported integration and provider requirements before advertising guaranteed subscription usage through a Precipice adapter.

Sources:

- https://developers.openai.com/siwc/quickstart
- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/siwc/ui-ux-guidelines
- https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account

## Findings in the current app

- `src/app/useAppSettings.ts` treats an API key and a single Anthropic model as global AI readiness.
- `src/app/Home.tsx` interrupts creation for Settings when a key is absent; the interrupted request has no connection-resume contract.
- `src/app/Editor.tsx` has key-specific guards and disabled actions across multiple entry points.
- `src/ai/generate.ts` owns validated streaming tool application and transaction grouping; retain this behavior.
- `src/ai/scapi/ask.ts` creates Anthropic-specific search, caching, reasoning settings, and replayable tool history. These cannot be passed unchanged to another provider.
- `src/ai/models.ts` is a static Anthropic catalog; it cannot represent ChatGPT model access.
- `src/app/SettingsModal.tsx` exposes API keys under General and instructions under AI. AI connection management should become the primary AI surface.
- `worker/index.ts` is a stateless Anthropic relay, not an OAuth session service. Adding user refresh tokens would materially change its responsibility.
- Existing desktop Keychain support can store Precipice-owned credentials. Existing publication identity and MCP grants have different permissions and must remain distinct.
- The worktree contains ongoing dictation, persistence, and Scapi changes. Preserve those changes and adapt edits to their current content.

## User experience

1. A new user can explore immediately. On the first AI request, show a compact connection dialog with their draft preserved and one prominent action: Continue with ChatGPT, when supported by the configured deployment.
2. Explain the action in one line: use your eligible ChatGPT plan for Scapi. Avoid unlimited or free usage claims.
3. Complete provider consent in the system browser or supported web redirect. Show a waiting state, cancel, and a clear recovery action if the window closes or sign-in expires.
4. Return to the original surface and resume the pending request exactly once. Revalidate the active scape, edit lease, selection, and document revision before a resumed write; request reconfirmation if its target changed.
5. Connected state shows provider, account/workspace, and whether plan usage is enabled. Offer Manage usage and Disconnect. Do not show success for identity-only consent.
6. Put API-key setup and external-agent connections under Other ways to connect. Existing users with working keys keep their chosen connection until they switch.
7. Use a quiet connection control near Scapi and a fuller AI settings panel. Default to a sensible available model and offer model selection secondarily.
8. Handle cancelled sign-in, permission denied, plan unavailable, expired session, offline state, exhausted usage, and companion unavailable with specific recovery actions. Never silently switch to paid API-key billing.
9. Follow existing typography, colors, focus management, and motion tokens. Verify keyboard navigation, screen-reader status updates, mobile layout, dark/light themes, and reduced motion.

## Shared architecture

Introduce an AI connection service that owns connection state, active provider, account metadata, model choice, and capabilities. States include checking, disconnected, connecting, connected, reconnect-required, unavailable, and error; usage exhaustion is a provider result with recovery metadata.

Keep credentials behind a transport boundary. UI and document code consume connection summaries and request methods, never refresh tokens. Store selected connection and per-provider model preferences separately from secrets. Disconnect clears local session material and pending requests and invokes provider revocation where supported.

Separate three responsibilities:

- Connection/authentication: OAuth lifecycle, permission validation, refresh concurrency, disconnect, account selection.
- Provider runtime: normalized text, reasoning-summary, source, tool-call, tool-result, error, and completion events; explicit capabilities for search and tools.
- Canvas orchestration: existing prompt/context construction, schema validation, allowed operations, read-only Ask, transaction grouping, undo, cancellation, and revision checks.

Normalize conversational history at the provider boundary. Do not replay Anthropic tool records into OpenAI requests. When changing providers, retain the visible transcript and rebuild context from portable user/assistant content, excluding incompatible internal reasoning and tool records.

## Deployment paths

### Desktop and local open-source installations

Implement the official ChatGPT OAuth flow with stable host identity, fresh PKCE/state/nonce, loopback callback validation, issued-client persistence, ID-token/scope verification, and refresh handling. Native code owns credentials and inference. Save secrets in Keychain and return only connection summaries and normalized events over restricted IPC.

Use direct Responses inference with Precipice's existing tools. Observe the plan-usage request contract, including streaming and store:false, explicit input history, and omission of unsupported fields. Stream tool outputs back into the bounded agent loop. Discover models through the supported contract and verify access through successful inference.

### Hosted browser app

First establish the approved hosted integration and callback configuration. If granted, use a dedicated OAuth/session service with HttpOnly Secure cookies, CSRF protection, encrypted server-side refresh-token storage, serialized refresh, and streaming inference endpoints. A Cloudflare Worker can handle fetch-based Responses inference; it cannot directly spawn codex app-server.

Until hosted access is established, the implementable subscription path is a local companion. Prefer reusing the installed Precipice desktop app as the companion rather than requiring a second install. Pair the browser to the app explicitly, restrict origins, authenticate every request, bind grants to the intended browser, and allow revocation. Validate HTTPS-to-loopback behavior and browser local-network permissions before selecting the exact transport; the existing authenticated relay may offer an alternative.

The browser's selected canvas snapshot and validated operation results must travel over the bridge. Its IndexedDB library is distinct from the desktop app's library; a request from the web must not accidentally edit a desktop copy. User-facing setup should say Connect Precipice on this Mac and explain that the app must remain running.

### Claude Code

Add after the shared connection layer and ChatGPT vertical slice. Detect and drive the official local executable using its documented process interface. Confirm the supported subscription integration, constrain the agent to the current request, and route canvas mutations through validated Precipice operations. Treat process versions, tool permissions, cancellation, and availability as explicit capabilities. Do not label an ordinary Claude login as a universal web subscription connection.

## Implementation sequence and review gates

1. Resolve deployment eligibility and prove one real authenticated Responses request in a supported environment. This determines whether web launch uses hosted OAuth or the companion path.
2. Add the shared connection service, normalized runtime contract, and per-provider model state while retaining the existing Anthropic adapter.
3. Complete a ChatGPT vertical slice: connect, verify plan permission, stream an Ask answer, persist safely, refresh, reconnect, and disconnect.
4. Move generation/Edit/Connect onto the runtime interface; preserve tool validation, one-step undo, cancellation, and allowed-type restrictions.
5. Integrate the connection dialog, resume-on-connect behavior, settings, and all AI readiness guards. Move secondary options into the supporting UI.
6. Implement and exercise the approved hosted path or desktop companion end to end for the browser library.
7. Add Claude Code as a supported local choice after its provider contract is verified.
8. Complete migration, docs, UI verification, and release checks. Enable subscription-first presentation only for working deployments; do not ship a primary button that cannot complete authentication.

## Acceptance criteria

- A user can connect without an API key, return to their draft, and receive a real streamed response.
- Creation, Ask, Edit, and Connect use the selected connection consistently.
- Ask cannot mutate; Edit remains schema-validated and one-step undoable.
- Aborted streams and failed tool calls never report successful completion or duplicate mutations.
- Refresh races, cancelled OAuth, invalid callback state, wrong consent scopes, and expired sessions have meaningful automated coverage.
- Browser/desktop secrets do not appear in localStorage, IndexedDB documents, exports, logs, service-worker caches, or screenshots.
- Account/provider switches isolate models and history and cannot silently change billing paths.
- Web companion requests operate on the requesting browser's canvas and respect its edit lease.
- Existing API-key users can continue using their setup and choose when to connect a subscription.
- Verify build/type checks, relevant runtime/auth tests, UI keyboard/accessibility checks, and live account sign-in/inference. Mock tests cannot establish provider eligibility or working production OAuth.

## Outstanding external dependency

Unrestricted hosted ChatGPT plan usage is not established by the public documentation or this repository. The hosted release requires approved access, or a functioning companion-backed implementation. The first implementation milestone must prove this dependency rather than hiding it behind a polished sign-in button.
