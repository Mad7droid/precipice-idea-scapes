import { useCallback, useEffect, useState } from "react";
import { notify } from "@/core/notify";
import { Button } from "@/design/Button";
import { isDesktop } from "@/desktop/runtime";
import { hostToken } from "@/mcp/host/credential";
import { startDesktopSignIn } from "@/mcp/host/desktopAuth";
import { agentLabels, useAgentStore } from "@/mcp/host/agentStore";
import { connectApi, type AgentConnection } from "@/mcp/host/connectApi";
import { LOCAL_MODE_KEY, localApplyMode } from "@/mcp/host/desktopLocal";
import { MCP_ENDPOINT } from "@/mcp/host/relay";
import { refreshAgentRelay } from "@/mcp/host/runtime";

/**
 * Settings → Agents. Setup is copy-and-paste once per agent; after that this panel is only
 * for seeing and removing what is connected.
 */
type ClientId = "claude" | "claude-code" | "codex" | "chatgpt" | "cursor";

const CLIENTS: { id: ClientId; label: string }[] = [
  { id: "claude", label: "Claude" },
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "cursor", label: "Cursor" },
];

function copy(text: string, what = "Copied.") {
  void navigator.clipboard?.writeText(text).then(
    () => notify.success(what),
    () => notify.error("Could not copy. Select the text and copy it instead."),
  );
}

function Snippet({ text, label }: { text: string; label?: string }) {
  return (
    <div className="mt-1.5 flex items-start gap-2 rounded-md bg-inset px-2.5 py-2">
      <code className="mono normal-case min-w-0 flex-1 select-all whitespace-pre-wrap break-all text-2xs text-fg">
        {text}
      </code>
      <button
        type="button"
        className="shrink-0 rounded-sm px-1.5 py-0.5 text-2xs text-fg-secondary hover:bg-active"
        onClick={() => copy(text, label ?? "Copied.")}
      >
        Copy
      </button>
    </div>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return (
    <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs text-fg-secondary">{children}</ol>
  );
}

function CloudSetup({ client }: { client: ClientId }) {
  const url = MCP_ENDPOINT;
  switch (client) {
    case "claude":
      return (
        <Steps>
          <li>
            In Claude (web, desktop or mobile), open{" "}
            <b className="text-fg">Settings → Connectors</b> and choose{" "}
            <b className="text-fg">Add custom connector</b>.
          </li>
          <li>
            Name it Precipice and paste this URL:
            <Snippet text={url} label="Connector URL copied." />
          </li>
          <li>Select Connect, then Allow on the Precipice screen that opens.</li>
        </Steps>
      );
    case "claude-code":
      return (
        <Steps>
          <li>
            Run this once in a terminal:
            <Snippet text={`claude mcp add --transport http precipice ${url}`} />
          </li>
          <li>
            In Claude Code, run <code className="mono">/mcp</code>, pick precipice and authenticate.
          </li>
        </Steps>
      );
    case "codex":
      return (
        <Steps>
          <li>
            Run these once in a terminal:
            <Snippet text={`codex mcp add precipice --url ${url}\ncodex mcp login precipice`} />
          </li>
          <li>Allow the connection on the Precipice screen that opens.</li>
        </Steps>
      );
    case "chatgpt":
      return (
        <Steps>
          <li>
            In ChatGPT, turn on{" "}
            <b className="text-fg">Settings → Apps → Advanced → Developer mode</b>, then create an
            app.
          </li>
          <li>
            Paste this URL and choose OAuth:
            <Snippet text={url} label="Connector URL copied." />
          </li>
        </Steps>
      );
    case "cursor":
      return (
        <Steps>
          <li>
            Add this to <code className="mono">~/.cursor/mcp.json</code>:
            <Snippet text={JSON.stringify({ mcpServers: { precipice: { url } } }, null, 2)} />
          </li>
          <li>Cursor opens Precipice to sign in the first time it connects.</li>
        </Steps>
      );
  }
}

/** Desktop only: agents on this Mac run Precipice's own helper, with no account or port. */
function LocalSetup({ client }: { client: ClientId }) {
  const [helper, setHelper] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke<string>("mcp_helper_path").then(setHelper, () => setHelper(null)),
    );
  }, []);
  const install = async (target: "claude-desktop" | "codex" | "cursor") => {
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      notify.success(await invoke<string>("mcp_install_client", { client: target }));
    } catch (error) {
      notify.error("Could not add Precipice.", String(error));
    } finally {
      setBusy(false);
    }
  };
  if (client === "claude")
    return (
      <Steps>
        <li>
          <Button
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={() => void install("claude-desktop")}
          >
            Add to Claude Desktop
          </Button>
        </li>
        <li>Restart Claude Desktop. Precipice appears in its tools; no sign-in needed.</li>
      </Steps>
    );
  if (client === "codex" || client === "cursor")
    return (
      <Steps>
        <li>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void install(client)}>
            Add to {client === "codex" ? "Codex" : "Cursor"}
          </Button>
        </li>
        <li>Start a new session. Precipice opens itself when the agent needs it.</li>
      </Steps>
    );
  if (client === "claude-code")
    return (
      <Steps>
        <li>
          Run this once in a terminal:
          <Snippet
            text={`claude mcp add precipice -- "${helper ?? "/Applications/Precipice.app/Contents/MacOS/Precipice"}" --mcp`}
          />
        </li>
      </Steps>
    );
  return (
    <p className="mt-2 text-xs text-fg-tertiary">ChatGPT connects through the cloud connector.</p>
  );
}

function relative(ms: number): string {
  if (!ms) return "awaiting first connection";
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  return new Date(ms).toLocaleDateString();
}

export function AgentsPanel() {
  const desktop = isDesktop();
  const [client, setClient] = useState<ClientId>("claude");
  const [where, setWhere] = useState<"local" | "cloud">(desktop ? "local" : "cloud");
  const [connections, setConnections] = useState<AgentConnection[] | null>(null);
  const [localMode, setLocalMode] = useState(() => localApplyMode());
  const localClients = useAgentStore((s) => s.localClients);
  const [, rerender] = useState(0);
  useEffect(() => {
    const update = () => rerender((n) => n + 1);
    window.addEventListener("precipice-agent-auth", update);
    return () => window.removeEventListener("precipice-agent-auth", update);
  }, []);
  const signedIn = hostToken() !== null;

  const load = useCallback(() => {
    if (!signedIn || !MCP_ENDPOINT) return;
    void connectApi.connections().then(setConnections, () => setConnections([]));
  }, [signedIn]);
  useEffect(load, [load]);

  const remove = async (id?: string) => {
    try {
      await (id ? connectApi.revoke(id) : connectApi.revokeAll());
      notify.success(id ? "Agent removed." : "All agents removed.");
      refreshAgentRelay();
      load();
    } catch {
      notify.error("Could not remove the agent. Try again.");
    }
  };

  const cloudAvailable = Boolean(MCP_ENDPOINT);

  return (
    <section aria-labelledby="agents-heading">
      <h3 id="agents-heading" className="sr-only">
        Agents
      </h3>
      <p className="text-xs text-fg-secondary">
        Let Claude, Codex and other agents read and build on your scapes. They work on the copy on
        this device, through the same undo as your own edits.
      </p>

      <div className="mt-4">
        <span className="mb-1 block text-xs text-fg-secondary">Connect an agent</span>
        {desktop && cloudAvailable && (
          <div className="mb-2 flex gap-1" role="tablist" aria-label="Where the agent runs">
            {(["local", "cloud"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={where === value}
                onClick={() => setWhere(value)}
                className={
                  "rounded-md px-2 py-1 text-2xs " +
                  (where === value ? "bg-raised text-fg" : "text-fg-secondary hover:bg-hover")
                }
              >
                {value === "local" ? "On this Mac" : "Anywhere (account)"}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Agent">
          {CLIENTS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={client === entry.id}
              onClick={() => setClient(entry.id)}
              className={
                "rounded-full border px-2.5 py-1 text-2xs transition-colors duration-instant " +
                (client === entry.id
                  ? "border-strong bg-raised text-fg"
                  : "border-subtle text-fg-secondary hover:bg-hover")
              }
            >
              {entry.label}
            </button>
          ))}
        </div>
        {desktop && where === "local" ? (
          <LocalSetup client={client} />
        ) : cloudAvailable ? (
          <>
            {desktop && !signedIn && (
              <div className="mt-3">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() =>
                    void startDesktopSignIn().catch((error) =>
                      notify.error("Could not open sign-in.", String(error)),
                    )
                  }
                >
                  Connect this Mac
                </Button>
              </div>
            )}
            <CloudSetup client={client} />
            {desktop && (
              <p className="mt-2 text-xs text-fg-secondary">
                Choose “Desktop app” on the agent's Precipice consent screen.
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-xs text-fg-tertiary">
            The cloud connector is not configured for this build.
          </p>
        )}
      </div>

      {desktop && (
        <div className="mt-5">
          <span className="mb-1 block text-xs text-fg-secondary">Agents on this Mac</span>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-fg">
            <input
              type="checkbox"
              checked={localMode === "review"}
              onChange={(event) => {
                const next = event.target.checked ? "review" : "direct";
                localStorage.setItem(LOCAL_MODE_KEY, next);
                if (next === "review")
                  Object.keys(localStorage)
                    .filter((key) => key.startsWith("precipice.agent.trust."))
                    .forEach((key) => localStorage.removeItem(key));
                setLocalMode(next);
              }}
            />
            Ask me before applying their changes
          </label>
          {localClients.length > 0 && (
            <p className="mt-1.5 text-2xs text-fg-tertiary">
              Connected now: {agentLabels(localClients).join(", ")}
            </p>
          )}
        </div>
      )}

      {cloudAvailable && signedIn && (
        <div className="mt-5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-fg-secondary">Authorized cloud clients</span>
            {connections && connections.length > 1 && (
              <button
                type="button"
                className="text-2xs text-fg-tertiary hover:text-danger"
                onClick={() => void remove()}
              >
                Remove all
              </button>
            )}
          </div>
          {connections === null ? (
            <p className="text-2xs text-fg-tertiary">Loading…</p>
          ) : connections.length === 0 ? (
            <p className="text-2xs text-fg-tertiary">None yet. Follow the steps above.</p>
          ) : (
            <ul className="divide-y divide-subtle rounded-md border border-subtle">
              {connections.map((connection) => (
                <li key={connection.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-fg">{connection.clientName}</p>
                    <p className="text-2xs text-fg-tertiary">
                      {connection.write
                        ? connection.mode === "direct"
                          ? "Can edit"
                          : "Can edit, asks first"
                        : "Read only"}
                      {" · "}
                      {connection.scapes === "all"
                        ? "All scapes"
                        : `${connection.scapes.length} scape${connection.scapes.length === 1 ? "" : "s"}`}
                      {" · "}
                      {relative(connection.lastUsedAt)}
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => void remove(connection.id)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
