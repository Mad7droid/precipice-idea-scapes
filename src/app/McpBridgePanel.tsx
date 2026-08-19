import type { McpBridge } from "@/mcp/bridge";

export function McpBridgePanel({ bridge }: { bridge: McpBridge }) {
  const connected = bridge.status === "connected";

  return (
    <section className="mt-5 border-t border-subtle pt-4" aria-labelledby="claude-mcp-heading">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 id="claude-mcp-heading" className="text-sm text-fg">
            Agent MCP
          </h3>
          <p className="mt-1 text-xs text-fg-tertiary">
            Share this open scape with a local Codex or Claude connection. Nothing is uploaded or retained.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void (connected ? bridge.disconnect() : bridge.connect())}
          disabled={bridge.status === "connecting"}
          className="shrink-0 rounded-md border border-subtle px-3 py-1.5 text-xs text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg disabled:opacity-60"
        >
          {bridge.status === "connecting" ? "Connecting…" : connected ? "Disconnect" : "Connect"}
        </button>
      </div>

      {bridge.status === "unavailable" && (
        <p className="mt-2 text-xs text-danger">
          Make sure Precipice is configured in Claude Desktop and restart Claude, then try again.
        </p>
      )}

      {connected && bridge.pairingCode && (
        <>
          <p className="mt-3 text-xs text-fg-secondary">
            In Codex or Claude, call <code className="mono">pair_with_precipice</code> with this code:
          </p>
          <p className="mono mt-1 select-all text-base tracking-[0.18em] text-fg">{bridge.pairingCode}</p>
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-fg-secondary">
            <input
              type="checkbox"
              checked={bridge.directApply}
              onChange={(event) => bridge.setDirectApply(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              Apply agent changes immediately. Leave this off to review each requested batch first.
            </span>
          </label>
        </>
      )}

      {bridge.pending.length > 0 && (
        <div className="mt-3 rounded-md border border-subtle bg-raised p-3">
          <p className="text-xs text-fg">
            {bridge.pending.length} agent {bridge.pending.length === 1 ? "change" : "changes"} ready to review
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => bridge.pending.forEach((command) => bridge.applyPending(command.id))}
              className="rounded-md bg-accent px-3 py-1.5 text-xs text-on-accent transition-colors duration-instant ease-out hover:bg-accent-hover"
            >
              Apply all
            </button>
            <button
              type="button"
              onClick={() => bridge.pending.forEach((command) => bridge.rejectPending(command.id))}
              className="rounded-md border border-subtle px-3 py-1.5 text-xs text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
            >
              Reject all
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
