import { create } from "zustand";
import type { McpOperation } from "@/mcp/contracts";

/**
 * What the app shows about connected agents. Deliberately small: one quiet indicator, one
 * review tray. Nothing here is persisted — the durable record is `mcpOperations`.
 */
export type RemoteStatus = "off" | "connecting" | "connected" | "signed_out" | "unavailable";

export interface AgentActivity {
  client: string;
  tool: string;
  at: number;
}

interface AgentState {
  remote: RemoteStatus;
  /** Desktop only: local MCP clients currently attached through the app's socket. */
  localClients: string[];
  last: AgentActivity | null;
  pending: McpOperation[];
  setRemote: (status: RemoteStatus) => void;
  setLocalClients: (clients: string[]) => void;
  record: (activity: AgentActivity) => void;
  addPending: (operation: McpOperation) => void;
  removePending: (key: string) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  remote: "off",
  localClients: [],
  last: null,
  pending: [],
  setRemote: (remote) => set({ remote }),
  setLocalClients: (localClients) => set({ localClients }),
  record: (last) => set({ last }),
  addPending: (operation) =>
    set((state) => ({
      pending: [...state.pending.filter((op) => op.key !== operation.key), operation],
    })),
  removePending: (key) =>
    set((state) => ({ pending: state.pending.filter((op) => op.key !== key) })),
}));

/**
 * MCP clients report package names (`claude-ai`, `codex-mcp-client`, Claude Desktop's
 * `local-agent-mode-precipice`); people know products.
 */
export function agentLabel(name: string): string {
  if (/claude|local-agent-mode/i.test(name)) return "Claude";
  if (/codex/i.test(name)) return "Codex";
  if (/cursor/i.test(name)) return "Cursor";
  if (/chatgpt|openai/i.test(name)) return "ChatGPT";
  // Unknown client: drop plumbing words and read it as a name rather than an identifier.
  const words = name
    .replace(/[-_.]+/g, " ")
    .replace(/\b(mcp|client|precipice)\b/gi, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.length > 0
    ? words.map((word) => word[0].toUpperCase() + word.slice(1)).join(" ")
    : name;
}

/** Distinct product names, in connection order. */
export function agentLabels(names: string[]): string[] {
  return [...new Set(names.map(agentLabel))];
}
