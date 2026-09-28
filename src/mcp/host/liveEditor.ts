import { useScapeStore } from "@/core/store";
import { layoutAction } from "@/canvas/layout";
import { applyBatch, revision } from "@/mcp/document";
import { saveOperation } from "@/mcp/operations";
import type { LiveScape } from "@/mcp/service";

/** Persist the complete batch before exposing it to the canvas or acknowledging it. */
export function liveEditor(options: {
  scapeId: string;
  canWrite(): boolean;
  flush(): Promise<void>;
  focus(ids: string[]): void;
}): LiveScape {
  const current = () => {
    const scape = useScapeStore.getState().scape;
    if (!scape || scape.id !== options.scapeId) throw new Error("not_found");
    return scape;
  };
  return {
    current,
    canWrite: options.canWrite,
    selection: () => useScapeStore.getState().selection,
    focus: options.focus,
    apply: (payloads, txId, layout, operation) =>
      useScapeStore.getState().commit(async (token) => {
        if (!options.canWrite()) throw new Error("read_only");
        await options.flush();
        const before = current();
        const first = applyBatch(before, payloads, txId);
        const batch = layout
          ? applyBatch(before, [...payloads, layoutAction(first.state, layout)], txId)
          : first;
        if (operation) {
          operation.inverses = batch.inverses;
          operation.afterRevision = await revision(batch.state);
          operation.result = {
            status: "applied",
            operation_id: operation.key,
            revision: operation.afterRevision,
            message: String(operation.command.args.__summary ?? "Applied."),
          };
          await saveOperation(
            operation,
            batch.state,
            batch.actions,
            undefined,
            () => options.canWrite() && useScapeStore.getState().scape === before,
          );
        }
        if (!options.canWrite() || useScapeStore.getState().scape !== before)
          throw new Error("read_only");
        for (const action of batch.actions) useScapeStore.getState().dispatch(action, token);
        // These actions are already persisted above; autosave may still save the current snapshot.
        if (operation) useScapeStore.getState().drainActionLog();
        return { inverses: batch.inverses };
      }),
  };
}
