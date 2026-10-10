import { AgentsPanel } from "../agents/AgentsPanel";
import { PageHeader } from "./PageHeader";

export function AgentsPage(_: { desktop: boolean }) {
  return (
    <>
      <PageHeader title="Agents">
        Let Claude, Codex and others work on your scapes. You review every change.
      </PageHeader>
      <div className="max-w-2xl rounded-xl border border-subtle bg-surface p-5">
        <AgentsPanel />
      </div>
    </>
  );
}
