/** App-scoped commands, not OS-global shortcuts or document actions. */
export const WORKSPACE_EVENT = "precipice:workspace";
export type WorkspaceCommand = "capture" | "search";
export function openWorkspaceTool(tool: WorkspaceCommand): void {
  window.dispatchEvent(new CustomEvent(WORKSPACE_EVENT, { detail: tool }));
}
