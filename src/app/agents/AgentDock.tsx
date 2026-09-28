import { useEffect, useState } from "react";
import { notify } from "@/core/notify";
import { Button } from "@/design/Button";
import { agentLabel, agentLabels, useAgentStore } from "@/mcp/host/agentStore";
import { connectApi } from "@/mcp/host/connectApi";
import { agentHost } from "@/mcp/host/host";

/**
 * The only agent UI that appears on its own: a quiet "Claude is working" pill while an agent is
 * active, and a review card when a change is waiting for the person. No connection banners —
 * connecting is automatic, and an agent that cannot reach Precipice tells the person itself.
 */
const ACTIVE_MS = 90_000;
const FIRST_CALL_KEY = "precipice.agent.greeted";

export function AgentDock() {
  const last = useAgentStore((s) => s.last);
  const pending = useAgentStore((s) => s.pending);
  const localClients = useAgentStore((s) => s.localClients);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);

  // Re-render when the activity window lapses, so the pill goes away without a poll.
  useEffect(() => {
    if (!last) return;
    setNow(Date.now());
    const remaining = last.at + ACTIVE_MS - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), remaining + 50);
    return () => clearTimeout(timer);
  }, [last]);

  // One welcome, the first time any agent ever reaches this Precipice.
  useEffect(() => {
    if (!last) return;
    try {
      if (localStorage.getItem(`${FIRST_CALL_KEY}.${last.client}`)) return;
      localStorage.setItem(`${FIRST_CALL_KEY}.${last.client}`, "1");
    } catch {
      return;
    }
    notify.success(
      `${agentLabel(last.client)} is connected.`,
      "It can now read and build on your scapes.",
    );
  }, [last]);

  const active = last && now - last.at < ACTIVE_MS;
  // Agents attached to this Mac stay visible while idle, as a quieter version of the pill.
  const connected = agentLabels(localClients);
  if (!active && pending.length === 0 && connected.length === 0) return null;

  const resolve = async (key: string, approve: boolean) => {
    setBusy(key);
    try {
      const outcome = await agentHost().resolveReview(key, approve);
      if (approve && outcome.status === "failed")
        notify.error("Could not apply the change.", String(outcome.message ?? outcome.error));
    } catch {
      notify.error("Could not finish the review. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="pointer-events-none fixed right-4 top-14 z-toast flex max-w-[340px] flex-col items-end gap-2">
      {pending.map((operation) => {
        const args = operation.command.args as {
          __summary?: string;
          __client?: string;
          __clientId?: string;
        };
        const deleting = operation.command.tool === "delete_scape";
        const publishing = ["publish_scape", "unpublish_scape"].includes(operation.command.tool);
        return (
          <div
            key={operation.key}
            role="alertdialog"
            aria-label={`${args.__client ?? "An agent"} wants to change a scape`}
            className="pointer-events-auto rounded-lg border border-subtle bg-surface p-3 shadow-lg"
          >
            <p className="text-xs text-fg">
              {args.__client ?? "An agent"}{" "}
              {deleting ? "wants to delete a scape" : "suggests a change"}
            </p>
            <p className="mt-1 text-2xs text-fg-secondary">{args.__summary}</p>
            <div className="mt-2.5 flex gap-2">
              <Button
                variant={deleting ? "destructive" : "primary"}
                size="sm"
                disabled={busy === operation.key}
                onClick={() => void resolve(operation.key, true)}
              >
                {deleting ? "Delete" : "Apply"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy === operation.key}
                onClick={() => void resolve(operation.key, false)}
              >
                Decline
              </Button>
            </div>
            {!deleting && !publishing && args.__clientId && (
              <button
                type="button"
                className="mt-2 text-2xs text-fg-secondary hover:text-fg"
                disabled={busy === operation.key}
                onClick={() => {
                  const trust = args.__clientId!.startsWith("local:")
                    ? Promise.resolve().then(() =>
                        localStorage.setItem(`precipice.agent.trust.${args.__client}`, "direct"),
                      )
                    : connectApi.mode(args.__clientId!, "direct");
                  void trust
                    .then(() => resolve(operation.key, true))
                    .catch(() => notify.error("Could not save this agent's preference."));
                }}
              >
                Always apply changes from {args.__client ?? "this agent"}
              </button>
            )}
          </div>
        );
      })}
      {active && pending.length === 0 && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-full border border-subtle bg-surface px-3 py-1 text-2xs text-fg-secondary shadow-sm"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
          {agentLabel(last.client)} is working in Precipice
        </div>
      )}
      {!active && pending.length === 0 && connected.length > 0 && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-full border border-subtle bg-surface px-3 py-1 text-2xs text-fg-tertiary shadow-sm"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
          {connected.join(", ")} connected
        </div>
      )}
    </div>
  );
}
