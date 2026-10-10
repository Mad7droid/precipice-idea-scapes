import { publishFromAgent, shareFlowPreview } from "./publish";
import { allPlugins } from "@/core/registry";
import type { Scape } from "@/core/types";
import { summarize } from "@/core/registry";
import { db } from "@/persistence/db";
import { scapeRepository } from "@/persistence/scapeRepository";
import { failure, type McpOperation, type Outcome } from "@/mcp/contracts";
import { saveOperation } from "@/mcp/operations";
import {
  createCommandService,
  type CommandService,
  type Envelope,
  type LiveScape,
} from "@/mcp/service";
import { useAgentStore } from "./agentStore";

/**
 * The agent host: one per tab, shared by every MCP transport in that tab.
 *
 * A call names its scape explicitly. If this tab's editor holds that scape, the call runs
 * here; if another tab's editor holds it, the call is routed there over a BroadcastChannel so
 * the write lands in the editor the person is looking at (and on its undo stack); otherwise
 * it runs against the stored snapshot.
 */

const live = new Map<string, LiveScape>();

/** Called by the editor when it holds the write lease for a scape, and on unmount. */
export function registerLiveScape(scapeId: string, scape: LiveScape): () => void {
  live.set(scapeId, scape);
  return () => {
    if (live.get(scapeId) === scape) live.delete(scapeId);
  };
}

export function markdownOf(scape: Scape): string {
  const lines = [`# ${scape.name}`, ""];
  if (scape.instructions?.body) lines.push("> Instructions: " + scape.instructions.body, "");
  for (const id of scape.objectOrder) {
    const object = scape.objects[id];
    if (!object) continue;
    lines.push(`## ${object.title || "Untitled"} (${object.type}, ${object.id})`, "");
    lines.push(summarize(object), "");
  }
  const edges = Object.values(scape.relationships);
  if (edges.length) {
    lines.push("## Relationships", "");
    for (const edge of edges) {
      const from = scape.objects[edge.from]?.title ?? edge.from;
      const to = scape.objects[edge.to]?.title ?? edge.to;
      lines.push(`- ${from} → ${to}${edge.label ? ` (${edge.label})` : ""}`);
    }
  }
  return lines.join("\n");
}

function createService(): CommandService {
  return createCommandService({
    library: {
      list: () => scapeRepository.list(),
      get: (id) => scapeRepository.get(id),
      create: (name) => scapeRepository.create(name),
      duplicate: (id) => scapeRepository.duplicate(id),
      remove: async (id) => {
        live.delete(id);
        await scapeRepository.remove(id);
      },
      commit: (operation, scape, actions) => saveOperation(operation, scape, actions),
    },
    operations: {
      get: (key) => db.mcpOperations.get(key),
      put: async (operation) => void (await db.mcpOperations.put(operation)),
      forScape: async (scapeId, offset, limit) => {
        const rows = await db.mcpOperations.where("scapeId").equals(scapeId).toArray();
        return rows.sort((a, b) => b.expiresAt - a.expiresAt).slice(offset, offset + limit);
      },
    },
    live: (scapeId) => live.get(scapeId) ?? null,
    requestReview: (operation) => useAgentStore.getState().addPending(operation),
    capabilities: () =>
      allPlugins().map((plugin) => ({
        type: plugin.type,
        hint: plugin.aiHint,
        example: plugin.defaults(),
      })),
    markdown: markdownOf,
    publish: publishFromAgent,
    sharePreview: shareFlowPreview,
  });
}

type RouteMessage =
  | { kind: "who"; req: string; scapeId: string; from: string }
  | { kind: "have"; req: string; from: string }
  | { kind: "exec"; req: string; to: string; envelope: Envelope; from: string }
  | { kind: "done"; req: string; to: string; outcome: Outcome };

const WHO_WINDOW_MS = 150;

export interface AgentHost {
  execute(envelope: Envelope): Promise<Outcome>;
  resolveReview(key: string, approve: boolean): Promise<Outcome>;
  close(): void;
}

let singleton: AgentHost | null = null;

export function agentHost(): AgentHost {
  singleton ??= createAgentHost();
  return singleton;
}

export function createAgentHost(): AgentHost {
  const service = createService();
  const tabId = crypto.randomUUID();
  const channel =
    typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("precipice.mcp.route");
  const waiting = new Map<string, (message: RouteMessage) => void>();

  async function run(envelope: Envelope): Promise<Outcome> {
    const scapeId = (envelope.args as { scape_id?: string } | null)?.scape_id;
    // Cross-tab retries of a preview use the same target ID, even before the scape exists.
    // Do not hold this lock while forwarding to the editor tab, which acquires it itself.
    const outcome =
      typeof navigator !== "undefined" && navigator.locks && scapeId
        ? await navigator.locks.request(`precipice-mcp-command:${scapeId}`, () =>
            service.execute(envelope),
          )
        : await service.execute(envelope);
    useAgentStore
      .getState()
      .record({ client: envelope.grant.clientName, tool: envelope.tool, at: Date.now() });
    return outcome;
  }

  channel?.addEventListener("message", (event: MessageEvent<RouteMessage>) => {
    const message = event.data;
    if (message.kind === "who" && live.has(message.scapeId)) {
      channel.postMessage({ kind: "have", req: message.req, from: tabId } satisfies RouteMessage);
    } else if (message.kind === "exec" && message.to === tabId) {
      void run(message.envelope).then((outcome) =>
        channel.postMessage({
          kind: "done",
          req: message.req,
          to: message.from,
          outcome,
        } satisfies RouteMessage),
      );
    } else if (message.kind === "have" || (message.kind === "done" && message.to === tabId)) {
      waiting.get(message.req)?.(message);
    }
  });

  /** Which other tab, if any, holds this scape in an editor. */
  function locate(scapeId: string): Promise<string | null> {
    if (!channel) return Promise.resolve(null);
    const req = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(req);
        resolve(null);
      }, WHO_WINDOW_MS);
      waiting.set(req, (message) => {
        if (message.kind !== "have") return;
        clearTimeout(timer);
        waiting.delete(req);
        resolve(message.from);
      });
      channel.postMessage({ kind: "who", req, scapeId, from: tabId } satisfies RouteMessage);
    });
  }

  function forward(to: string, envelope: Envelope): Promise<Outcome> {
    const req = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(req);
        resolve(
          failure(
            "precipice_unavailable",
            "The Precipice tab holding this scape stopped responding.",
          ),
        );
      }, 20_000);
      waiting.set(req, (message) => {
        if (message.kind !== "done") return;
        clearTimeout(timer);
        waiting.delete(req);
        resolve(message.outcome);
      });
      channel!.postMessage({ kind: "exec", req, to, envelope, from: tabId } satisfies RouteMessage);
    });
  }

  return {
    async execute(envelope) {
      const scapeId = (envelope.args as { scape_id?: unknown } | null)?.scape_id;
      if (typeof scapeId === "string" && !live.has(scapeId)) {
        const owner = await locate(scapeId);
        if (owner) return forward(owner, envelope);
      }
      return run(envelope);
    },
    async resolveReview(key, approve) {
      const outcome = await service.resolveReview(key, approve);
      useAgentStore.getState().removePending(key);
      return outcome;
    },
    close() {
      channel?.close();
      if (singleton === this) singleton = null;
    },
  };
}

/** Pending reviews survive a reload: they are rows in `mcpOperations`, not just UI state. */
export async function restorePendingReviews(): Promise<void> {
  const now = Date.now();
  const rows = await db.mcpOperations.where("expiresAt").above(now).toArray();
  for (const row of rows as McpOperation[]) {
    if (row.result.status === "awaiting_review") useAgentStore.getState().addPending(row);
  }
}
