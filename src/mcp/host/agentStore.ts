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
  removePending: (key) => set((state) => ({ pending: state.pending.filter((op) => op.key !== key) })),
}));
