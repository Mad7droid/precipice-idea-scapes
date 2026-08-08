import { useEffect, useState } from "react";
import { useScapeStore } from "@/core/store";
import type { ObjectId, Relationship, Scape } from "@/core/types";

/**
 * The inspector for a relationship.
 *
 * `DisconnectObjects` has been in the action protocol since the beginning and was reachable
 * only by the model: a user could draw an edge and then had no way to label it, reverse it or
 * remove it. This is the other half of "connect blocks manually".
 *
 * Relabelling and reversing are a disconnect and a reconnect in one transaction, reusing the
 * same relationship id. There is no `UpdateRelationship` action and there does not need to
 * be — the pair composes correctly, undoes as one step, and keeps the id stable so nothing
 * pointing at this edge is invalidated.
 */
export function RelationshipInspector({
  scape,
  relationship,
  onClose,
  onFocusObject,
}: {
  scape: Scape;
  relationship: Relationship;
  onClose: () => void;
  onFocusObject: (id: ObjectId) => void;
}) {
  const dispatchTx = useScapeStore((s) => s.dispatchTx);
  const [label, setLabel] = useState(relationship.label ?? "");

  useEffect(() => setLabel(relationship.label ?? ""), [relationship.id, relationship.label]);

  const rewrite = (next: Partial<Pick<Relationship, "from" | "to" | "label">>) => {
    const merged = { ...relationship, ...next };
    const trimmed = merged.label?.trim();
    dispatchTx([
      { type: "DisconnectObjects", id: relationship.id },
      {
        type: "ConnectObjects",
        id: relationship.id,
        from: merged.from,
        to: merged.to,
        ...(trimmed ? { label: trimmed } : {}),
      },
    ]);
  };

  const commitLabel = () => {
    if ((label.trim() || undefined) !== relationship.label) rewrite({ label });
  };

  const endpoint = (id: ObjectId) => scape.objects[id]?.title || id;

  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-fg-secondary">Relationship</span>
        <button
          type="button"
          aria-label="Close inspector"
          onClick={onClose}
          className="grid h-6 w-6 place-items-center rounded-sm text-fg-tertiary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
        >
          ✕
        </button>
      </div>

      <div className="rounded-md border border-subtle bg-inset p-2">
        <Endpoint
          label="From"
          title={endpoint(relationship.from)}
          onClick={() => onFocusObject(relationship.from)}
        />
        <div aria-hidden className="py-1 pl-1 text-fg-tertiary">
          ↓
        </div>
        <Endpoint
          label="To"
          title={endpoint(relationship.to)}
          onClick={() => onFocusObject(relationship.to)}
        />
      </div>

      <label className="mt-3 block">
        <span className="mono block pb-1">Label</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          placeholder="constrains, on failure, evidence for"
          className="w-full rounded-sm border border-subtle bg-raised px-2 py-1.5 text-fg placeholder:text-fg-tertiary focus-self focus:border-focus"
        />
      </label>
      <p className="mt-1 text-xs text-fg-tertiary">
        Shown on the canvas when either end is selected.
      </p>

      <div className="mt-4 flex gap-1.5">
        <button
          type="button"
          onClick={() => rewrite({ from: relationship.to, to: relationship.from })}
          className="flex-1 rounded-full border border-subtle px-3 py-1.5 text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
        >
          Reverse
        </button>
        <button
          type="button"
          onClick={() => {
            dispatchTx([{ type: "DisconnectObjects", id: relationship.id }]);
            onClose();
          }}
          className="flex-1 rounded-full border border-subtle px-3 py-1.5 text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-danger"
        >
          Disconnect
        </button>
      </div>

      <p className="mono mt-4 truncate">{relationship.id}</p>
    </>
  );
}

function Endpoint({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Show on canvas"
      className="block w-full truncate rounded-sm px-1 py-0.5 text-left transition-colors duration-instant ease-out hover:bg-hover"
    >
      <span className="mono block">{label}</span>
      <span className="block truncate text-fg">{title}</span>
    </button>
  );
}
