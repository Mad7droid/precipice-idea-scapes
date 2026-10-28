import type { ReactNode } from "react";
import { Button } from "@/design/Button";
import { Select } from "@/design/Select";
import type { useAppSettings } from "@/app/useAppSettings";
import { CredentialSettings } from "@/desktop/CredentialSettings";
import { PROVIDERS, type ProviderId } from "./providers";
import type { AIConnection } from "./useAIConnection";

type Settings = ReturnType<typeof useAppSettings>;

/**
 * Settings → AI, top to bottom in the order someone sets it up: which connection, which
 * model, then optional routing. Only the chosen connection shows its controls.
 */
export function AISettings({
  settings,
  apiKey,
  onApiKeyChange,
}: {
  settings: Settings;
  apiKey: string;
  onApiKeyChange: (next: string) => void;
}) {
  const c = settings.connection;
  return (
    <div className="space-y-6">
      {settings.keychainDenied && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-subtle bg-inset px-3 py-2"
        >
          <p className="text-xs text-fg-secondary">
            Precipice can’t read its saved sign-ins and keys until you allow Keychain access.
          </p>
          <Button size="sm" variant="secondary" onClick={() => void settings.allowKeychain()}>
            Allow access
          </Button>
        </div>
      )}

      <Group title="Connection">
        <div role="radiogroup" aria-label="AI connection" className="space-y-1.5">
          {c.providers.map((id) => (
            <ProviderCard
              key={id}
              id={id}
              selected={c.provider === id}
              disabled={c.busy || c.claudeConnecting}
              onSelect={() => c.choose(id)}
              status={
                c.provider === id
                  ? statusLabel(
                      c,
                      apiKey,
                      settings.credentials.desktop && settings.credentials.saved,
                    )
                  : undefined
              }
            >
              {id === "claude-plan" && <ClaudePlan c={c} />}
              {id === "chatgpt" && <ChatGPTPlan c={c} />}
              {id === "anthropic" && (
                <AnthropicKey settings={settings} apiKey={apiKey} onApiKeyChange={onApiKeyChange} />
              )}
            </ProviderCard>
          ))}
        </div>
      </Group>

      <Group title="Model">
        <Select
          label="Model"
          value={settings.modelId}
          onChange={settings.setModelId}
          options={settings.models.map((m) => ({ value: m.id, label: m.label, title: m.hint }))}
          disabled={c.provider === "chatgpt" && c.status !== "connected"}
          className="w-full"
        />
        <p className="text-xs text-fg-tertiary">
          {/* The generic hint points at this page; here, point at the card above instead. */}
          {c.provider === "chatgpt" && c.status !== "connected"
            ? "Connect ChatGPT above to choose a model."
            : settings.models.find((m) => m.id === settings.modelId)?.hint}
        </p>
      </Group>

      <RoutingSettings settings={settings} />
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-sm font-medium text-fg">{title}</h3>
      {children}
    </section>
  );
}

/** A light shape check only; the provider is the judge of whether a key works. */
export function looksLikeAnthropicKey(key: string): boolean {
  return /^sk-ant-\S{8,}$/.test(key.trim());
}

function statusLabel(c: AIConnection, apiKey: string, desktopSaved = false): string {
  if (c.provider === "anthropic") {
    // On the Mac the key stays in Keychain; the saved flag is what counts.
    if (desktopSaved) return "Ready";
    if (!apiKey.trim()) return "Needs a key";
    return looksLikeAnthropicKey(apiKey) ? "Ready" : "Check the key";
  }
  return {
    checking: "Checking…",
    connecting: "Signing in…",
    connected: "Connected",
    disconnected: "Not connected",
  }[c.status];
}

function ProviderCard({
  id,
  selected,
  disabled,
  onSelect,
  status,
  children,
}: {
  id: ProviderId;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  status?: string;
  children: ReactNode;
}) {
  const info = PROVIDERS[id];
  return (
    <div
      className={
        "rounded-lg border transition-colors duration-instant ease-out " +
        (selected ? "border-strong bg-raised" : "border-subtle hover:bg-hover")
      }
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={disabled && !selected}
        onClick={onSelect}
        className="flex w-full items-start gap-2.5 px-3 py-2 text-left disabled:cursor-default"
      >
        <span
          aria-hidden
          className={
            "mt-1 h-3 w-3 shrink-0 rounded-full border " +
            (selected ? "border-4 border-accent" : "border-strong")
          }
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-sm text-fg">{info.name}</span>
            {status && <span className="text-xs text-fg-tertiary">{status}</span>}
          </span>
          <span className="block text-xs text-fg-tertiary">{info.summary}</span>
        </span>
      </button>
      {selected && <div className="space-y-2 pb-3 pl-8 pr-3">{children}</div>}
    </div>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

function Problem({ text }: { text?: string }) {
  if (!text || text.includes("Keychain access")) return null;
  return (
    <p role="alert" className="text-xs text-fg-secondary">
      {text}
    </p>
  );
}

function ClaudePlan({ c }: { c: AIConnection }) {
  const { claude } = c;
  if (c.claudeConnecting)
    return (
      <>
        <p className="text-xs text-fg-secondary">Finish signing in to Claude in your browser.</p>
        <Actions>
          <Button size="sm" variant="secondary" onClick={() => void c.cancelClaudeLogin()}>
            Cancel
          </Button>
        </Actions>
      </>
    );
  if (claude.checked && !claude.installed)
    return (
      <>
        <p className="text-xs text-fg-secondary">
          Install Claude Code once, then sign in here. Signing in to Claude Desktop alone does not
          connect Precipice.
        </p>
        <Actions>
          <Button size="sm" variant="primary" onClick={() => void c.openSettings("claude-install")}>
            Install Claude Code
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void c.refresh()}>
            Check again
          </Button>
        </Actions>
      </>
    );
  return (
    <>
      {claude.connected && (
        <p className="text-xs text-fg-secondary">{claude.email ?? "Your Claude account"}</p>
      )}
      <Actions>
        {claude.connected ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void c.openSettings("claude-usage")}
            >
              Usage
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void c.connectClaude()}>
              Switch account
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="primary"
            disabled={!claude.checked}
            onClick={() => void c.connectClaude()}
          >
            Sign in to Claude
          </Button>
        )}
      </Actions>
      <Problem text={claude.error} />
    </>
  );
}

function ChatGPTPlan({ c }: { c: AIConnection }) {
  const g = c.chatgpt;
  if (!c.chatgptAvailable)
    return (
      <p className="text-xs text-fg-secondary">ChatGPT sign-in is available in the Mac app.</p>
    );
  if (g.status === "connecting")
    return (
      <>
        <p className="text-xs text-fg-secondary">Finish signing in to ChatGPT in your browser.</p>
        <Actions>
          {c.signInUrl && (
            <a
              href={c.signInUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="self-center text-xs text-fg-accent underline"
            >
              Open sign-in again
            </a>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={c.busy}
            onClick={() => void c.disconnect()}
          >
            Cancel
          </Button>
        </Actions>
        <Problem text={g.error} />
      </>
    );
  if (g.status !== "connected")
    return (
      <>
        <Actions>
          <Button size="sm" variant="primary" disabled={c.busy} onClick={() => void c.connect()}>
            Sign in to ChatGPT
          </Button>
        </Actions>
        <Problem text={g.error} />
      </>
    );
  const profiles = g.profiles ?? [];
  return (
    <>
      {c.desktop && profiles.length > 1 ? (
        <Select
          label="ChatGPT account"
          value={g.connectionId ?? ""}
          disabled={c.busy}
          className="w-full text-xs"
          options={profiles.map((p) => ({ value: p.id, label: p.email }))}
          onChange={(id) => void c.selectAccount(id)}
        />
      ) : (
        <p className="text-xs text-fg-secondary">{g.email}</p>
      )}
      <Actions>
        <Button size="sm" variant="secondary" onClick={() => void c.openSettings("chatgpt-usage")}>
          Usage
        </Button>
        {c.desktop && (
          <Button
            size="sm"
            variant="secondary"
            disabled={c.busy}
            onClick={() => void c.connect(true)}
          >
            Add account
          </Button>
        )}
        <Button size="sm" variant="secondary" disabled={c.busy} onClick={() => void c.disconnect()}>
          Sign out
        </Button>
      </Actions>
      <Problem text={g.error} />
    </>
  );
}

function AnthropicKey({
  settings,
  apiKey,
  onApiKeyChange,
}: {
  settings: Settings;
  apiKey: string;
  onApiKeyChange: (next: string) => void;
}) {
  if (settings.credentials.desktop)
    return <CredentialSettings credentials={settings.credentials} />;
  return (
    <div>
      <label htmlFor="anthropic-api-key" className="mb-1 block text-xs text-fg-secondary">
        Anthropic API key
      </label>
      <div className="flex gap-2">
        <input
          id="anthropic-api-key"
          type="password"
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          placeholder="sk-ant-…"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!apiKey.trim() && !looksLikeAnthropicKey(apiKey)}
          className="mono normal-case tracking-normal placeholder:normal-case min-w-0 flex-1 rounded-md border border-subtle bg-inset px-3 py-1.5 text-sm text-fg placeholder:text-fg-tertiary focus-self"
        />
        {apiKey && (
          <Button size="sm" variant="secondary" onClick={() => onApiKeyChange("")}>
            Clear
          </Button>
        )}
      </div>
      {!!apiKey.trim() && !looksLikeAnthropicKey(apiKey) && (
        <p className="mt-1.5 text-xs text-danger">
          Anthropic keys start with “sk-ant-”. Check you pasted the whole key.
        </p>
      )}
      <p className="mt-1.5 text-xs text-fg-tertiary">
        Kept for this tab only and forwarded through the Precipice Worker, which stores nothing.
      </p>
    </div>
  );
}

type RoutingMode = "off" | "local" | "jev";
const ROUTING_MODES: { value: RoutingMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "local", label: "On device" },
  { value: "jev", label: "Jev" },
];

function RoutingSettings({ settings: s }: { settings: Settings }) {
  const mode: RoutingMode = !s.routeChips ? "off" : s.jevRouting ? "jev" : "local";
  const setMode = (next: RoutingMode) => {
    s.setRouteChips(next !== "off");
    s.setJevRouting(next === "jev");
  };
  return (
    <Group title="Routing suggestions">
      <div
        role="radiogroup"
        aria-label="Routing suggestions"
        className="flex items-center gap-0.5 rounded-full border border-subtle bg-inset p-0.5"
      >
        {ROUTING_MODES.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={mode === option.value}
            onClick={() => setMode(option.value)}
            className={
              "flex-1 rounded-full px-2.5 py-1 text-xs transition-colors duration-instant ease-out " +
              (mode === option.value
                ? "bg-raised text-fg shadow-sm"
                : "text-fg-tertiary hover:text-fg-secondary")
            }
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-fg-tertiary">
        {mode === "off"
          ? "You pick Ask or Edit, scope and model yourself."
          : mode === "local"
            ? "Suggests Ask or Edit, scope and model from your draft, on this device. You review before sending."
            : "Jev is TypeSafe’s hosted routing model: it reads your draft and suggests Ask or Edit, scope and model. Experimental. Sends draft text, selection counts and types, and short-command target titles to TypeSafe. Never audio or object contents."}
      </p>
      {mode === "jev" && (
        <div className="space-y-2">
          {s.jevCredentials.desktop ? (
            <CredentialSettings
              credentials={s.jevCredentials}
              id="typesafe-api-key"
              label="TypeSafe API key"
              placeholder="TypeSafe key"
            />
          ) : (
            <div>
              <label htmlFor="typesafe-api-key" className="mb-1 block text-xs text-fg-secondary">
                TypeSafe API key
              </label>
              <p className="mb-1 text-xs text-fg-tertiary">
                TypeSafe is the company that runs Jev; the key comes from your TypeSafe account.
              </p>
              <input
                id="typesafe-api-key"
                type="password"
                value={s.jevKey}
                onChange={(e) => s.setJevKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-md border border-subtle bg-inset px-3 py-1.5 text-sm text-fg focus-self"
              />
              <p className="mt-1.5 text-xs text-fg-tertiary">
                Kept for this tab only. Requests pass through the Precipice proxy.
              </p>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={s.jevOnly}
              onChange={(e) => s.setJevOnly(e.target.checked)}
            />
            Use Jev only
          </label>
          <p className="text-xs text-fg-tertiary">
            No on-device fallback: when Jev can’t answer within 4 s, Precipice says why instead of
            guessing.
          </p>
        </div>
      )}
    </Group>
  );
}
