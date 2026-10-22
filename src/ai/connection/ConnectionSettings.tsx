import { Button } from "@/design/Button";
import { Select } from "@/design/Select";
import type { useAppSettings } from "@/app/useAppSettings";

export function ConnectionSettings({ settings }: { settings: ReturnType<typeof useAppSettings> }) {
  const c = settings.connection;
  return (
    <section aria-label="AI connection" className="mb-4 space-y-2 border-b border-subtle pb-4">
      <h3 className="text-sm font-medium text-fg">AI connection</h3>
      <Select
        label="AI connection"
        value={c.provider}
        className="w-full text-xs"
        disabled={c.busy || c.claudeConnecting}
        options={[
          { value: "chatgpt", label: "ChatGPT plan" },
          ...(c.desktop ? [{ value: "claude-plan", label: "Claude plan · Claude Code" }] : []),
          { value: "anthropic", label: "Anthropic API · separate billing" },
        ]}
        onChange={(value) => {
          if (value === "chatgpt" || value === "anthropic" || value === "claude-plan")
            c.choose(value);
        }}
      />
      {c.provider === "chatgpt" &&
        (c.available ? (
          <>
            <p role="status" className="text-xs text-fg-secondary">
              {c.chatgptStatus === "connected"
                ? `${c.email} · ChatGPT plan usage enabled.`
                : c.chatgptStatus === "connecting"
                  ? "Waiting for ChatGPT sign-in…"
                  : c.chatgptStatus === "checking"
                    ? "Checking ChatGPT connection…"
                    : "Connect your eligible ChatGPT plan to use Scapi."}
            </p>
            {c.desktop && (c.profiles?.length ?? 0) > 1 && (
              <Select
                label="ChatGPT account"
                value={c.chatgptConnectionId ?? ""}
                disabled={c.busy}
                className="w-full text-xs"
                options={[
                  { value: "", label: "Choose saved account" },
                  ...c.profiles!.map((p) => ({
                    value: p.id,
                    label: `${p.email} · ${p.id.slice(0, 6)}`,
                  })),
                ]}
                onChange={(id) => {
                  if (id) void c.selectAccount(id);
                }}
              />
            )}
            <div className="flex flex-wrap gap-2">
              {c.chatgptStatus !== "connecting" && (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={c.busy}
                  onClick={() => void c.connect()}
                >
                  {c.chatgptStatus === "connected" ? "Reconnect ChatGPT" : "Continue with ChatGPT"}
                </Button>
              )}
              {(c.chatgptStatus === "connecting" || c.chatgptStatus === "connected") && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={c.busy}
                  onClick={() => void c.disconnect()}
                >
                  {c.chatgptStatus === "connecting" ? "Cancel sign-in" : "Disconnect"}
                </Button>
              )}
              {c.chatgptStatus === "connected" && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={c.busy}
                  onClick={() => void c.connect(true)}
                >
                  Add account
                </Button>
              )}
            </div>
            {c.signInUrl && (
              <a
                href={c.signInUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-fg-accent underline"
              >
                Open ChatGPT sign-in
              </a>
            )}
            <a
              href="https://chatgpt.com/settings/usage"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs text-fg-accent underline"
              onClick={(event) => {
                if (c.desktop) {
                  event.preventDefault();
                  void c.openSettings("chatgpt-usage");
                }
              }}
            >
              Manage ChatGPT usage and app access
            </a>
            <p className="text-xs text-fg-tertiary">
              {c.desktop
                ? "Credentials stay in this Mac’s Keychain."
                : "Credentials stay in a protected file on this Mac."}{" "}
              Sign-in opens in your browser. Your draft stays here.
            </p>
          </>
        ) : (
          <p className="text-xs text-fg-secondary">
            ChatGPT plan sign-in is available in the Mac app or the developer preview at 127.0.0.1.
            Hosted sign-in is unavailable.
          </p>
        ))}
      {c.provider === "claude-plan" && c.desktop && (
        <>
          <p role="status" className="text-xs text-fg-secondary">
            {c.claudeConnecting
              ? "Waiting for Claude sign-in in your browser…"
              : c.claude.connected
                ? `${c.claude.email ?? "Your Claude account"} · Connected through Claude Code.`
                : c.claude.installed
                  ? "Sign in to your Claude plan to use Scapi."
                  : "Install Claude Code to connect your Claude plan."}
          </p>
          <div className="flex flex-wrap gap-2">
            {c.claude.installed ? (
              <Button
                size="sm"
                variant="primary"
                disabled={c.claudeConnecting}
                onClick={() => void c.connectClaude()}
              >
                {c.claude.connected ? "Change Claude account" : "Sign in to Claude"}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                onClick={() => void c.openSettings("claude-install")}
              >
                Install Claude Code
              </Button>
            )}
            {c.claudeConnecting && (
              <Button size="sm" variant="secondary" onClick={() => void c.cancelClaudeLogin()}>
                Cancel sign-in
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => void c.refresh()}>
              Check connection
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void c.openSettings("claude-usage")}
            >
              Manage usage
            </Button>
          </div>
          <p className="text-xs text-fg-tertiary">
            Uses your Claude plan limits. Claude Desktop sign-in alone does not connect Scapi. Web
            search is unavailable.
          </p>
          {c.claude.error && (
            <p role="alert" className="text-xs text-fg-secondary">
              {c.claude.error}
            </p>
          )}
        </>
      )}
      {c.provider === "anthropic" && (
        <p className="text-xs text-fg-secondary">
          Use an Anthropic API key below. API usage is billed separately from your Claude
          subscription.
        </p>
      )}
      {c.error && (
        <p role="alert" className="text-xs text-fg-secondary">
          {c.error}
        </p>
      )}
      <p className="text-xs text-fg-tertiary">Billing connections never switch automatically.</p>
    </section>
  );
}
