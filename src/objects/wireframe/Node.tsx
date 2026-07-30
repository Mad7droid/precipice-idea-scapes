import type { ScapeObject } from "@/core/types";
import { EmptyHint } from "../ui";
import { VISIBLE_PRIMITIVES, type Primitive, type WireframeData } from "./schema";

export function WireframeNode({ object }: { object: ScapeObject; selected: boolean }) {
  const primitives = ((object.data as Partial<WireframeData>).primitives ?? []).filter(Boolean);
  const shown = primitives.slice(0, VISIBLE_PRIMITIVES);
  const overflow = primitives.length - shown.length;

  return (
    <>
      <h4 className="text-sm font-medium leading-snug text-fg">{object.title || "Untitled"}</h4>
      <div className="lod-body mt-2">
        {primitives.length === 0 ? (
          <EmptyHint>No elements yet</EmptyHint>
        ) : (
          <>
            {/* A real low-fidelity wireframe, at node scale: 12 columns, blocks, no text. */}
            <div className="grid grid-cols-12 gap-1 rounded-sm bg-canvas p-1.5">
              {shown.map((p) => (
                <Block key={p.id} primitive={p} />
              ))}
            </div>
            {overflow > 0 && <p className="mt-1 text-xs text-fg-tertiary">+{overflow} more</p>}
          </>
        )}
      </div>
    </>
  );
}

function Block({ primitive }: { primitive: Primitive }) {
  const span = Math.min(12, Math.max(1, primitive.span || 12));
  return (
    <div style={{ gridColumn: `span ${span} / span ${span}` }} title={primitive.label}>
      <Shape primitive={primitive} />
    </div>
  );
}

function Shape({ primitive }: { primitive: Primitive }) {
  switch (primitive.kind) {
    case "box":
      return <div className="h-6 rounded-xs border border-subtle bg-inset" />;
    case "text":
      return (
        <div className="space-y-[3px] py-[3px]">
          <div className="h-[3px] w-full rounded-full bg-active" />
          <div className="h-[3px] w-3/5 rounded-full bg-active" />
        </div>
      );
    case "input":
      return <div className="h-3.5 rounded-xs border border-default bg-inset" />;
    case "button":
      return <div className="h-3.5 rounded-xs border border-strong bg-active" />;
    case "list":
      return (
        <div className="space-y-[3px]">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[3px] w-full rounded-full bg-active" />
          ))}
        </div>
      );
  }
}
