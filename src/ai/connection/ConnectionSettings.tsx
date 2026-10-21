import { Button } from "@/design/Button";
import type { useAppSettings } from "@/app/useAppSettings";

export function ConnectionSettings({ settings }: { settings: ReturnType<typeof useAppSettings> }) {
  const c = settings.connection;
  return (
    <section aria-label="AI connection" className="mb-5 space-y-3 border-b border-subtle pb-5">
      <h3 className="text-sm font-medium text-fg">AI connection</h3>
      {c.available ? (
        <>
          <p className="text-xs text-fg-secondary">
            Use your eligible ChatGPT plan for Scapi chat and canvas creation. Plan limits apply.
            Sign-in opens with OpenAI; your draft stays here. After returning, send when ready.
          </p>
          <p role="status" className="text-xs text-fg-secondary">
            {c.status === "connected"
              ? `Connected as ${c.email}. ChatGPT plan permission is enabled.`
              : c.status === "connecting"
                ? "Waiting for ChatGPT sign-in…"
                : "ChatGPT is not connected."}
          </p>
          <div className="flex flex-wrap gap-2">
            {c.status !== "connecting" && (
              <Button
                variant={c.provider === "chatgpt" ? "primary" : "secondary"}
                size="sm"
                disabled={c.busy}
                onClick={() => void c.connect()}
              >
                {c.status === "connected" ? "Reconnect ChatGPT" : "Continue with ChatGPT"}
              </Button>
            )}
            {c.status !== "connecting" && (
              <Button
                variant="secondary"
                size="sm"
                disabled={c.busy}
                onClick={() => void c.connect(true)}
              >
                Use another ChatGPT account
              </Button>
            )}
            {c.status === "connected" && c.provider !== "chatgpt" && (
              <Button variant="primary" size="sm" onClick={() => c.choose("chatgpt")}>
                Use ChatGPT
              </Button>
            )}
            {(c.status === "connecting" || c.status === "connected") && (
              <Button
                variant="secondary"
                size="sm"
                disabled={c.busy}
                onClick={() => void c.disconnect()}
              >
                {c.status === "connecting" ? "Cancel sign-in" : "Disconnect ChatGPT"}
              </Button>
            )}
          </div>
          {c.signInUrl && (
            <a
              href={c.signInUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-fg-accent underline"
            >
              Open ChatGPT sign-in
            </a>
          )}
          <a
            href="https://chatgpt.com/#settings"
            target="_blank"
            rel="noopener noreferrer"
            className="block text-xs text-fg-accent underline"
          >
            Manage ChatGPT usage and app access
          </a>
          <p className="text-xs text-fg-tertiary">
            This local preview keeps credentials in a protected file on this Mac. Disconnect removes
            the local connection; revoke app access in ChatGPT settings to remove the provider
            grant.
          </p>
        </>
      ) : (
        <p className="text-xs text-fg-secondary">
          ChatGPT subscription sign-in is available in the local developer preview at 127.0.0.1.
          Hosted and Mac app connections are still being built.
        </p>
      )}
      {c.error && (
        <p role="alert" className="text-xs text-fg-secondary">
          {c.error}
        </p>
      )}
      <p className="text-xs text-fg-tertiary">
        Selected connection: {c.provider === "chatgpt" ? "ChatGPT plan" : "Anthropic API"}. Billing
        connections never switch automatically.
      </p>
      <details>
        <summary className="cursor-pointer text-xs text-fg-secondary">
          Other ways to connect
        </summary>
        <div className="mt-2 space-y-2">
          <p className="text-xs text-fg-tertiary">
            Use an Anthropic API key with separate API billing, or connect an external agent from
            the Agents section.
          </p>
          <Button variant="secondary" size="sm" onClick={() => c.choose("anthropic")}>
            Use Anthropic API
          </Button>
        </div>
      </details>
    </section>
  );
}
