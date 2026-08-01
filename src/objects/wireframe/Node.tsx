import { createContext, useContext, useState } from "react";
import { useScapeStore } from "@/core/store";
import type { ScapeObject } from "@/core/types";
import { EmptyHint, ExpandToggle } from "../ui";
import { VISIBLE_PRIMITIVES, type Primitive, type WireframeData } from "./schema";

/** Expanded cards let labels wrap instead of truncating, so a long screen reads in full. */
const Expanded = createContext(false);

export function WireframeNode({ object }: { object: ScapeObject; selected: boolean }) {
  const primitives = ((object.data as Partial<WireframeData>).primitives ?? []).filter(Boolean);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? primitives : primitives.slice(0, VISIBLE_PRIMITIVES);
  const overflow = primitives.length - shown.length;
  const [editingTitle, setEditingTitle] = useState(false);

  return (
    <>
      {editingTitle ? (
        <input
          autoFocus
          defaultValue={object.title}
          onBlur={(e) => {
            setEditingTitle(false);
            useScapeStore
              .getState()
              .dispatchTx([
                { type: "UpdateObject", id: object.id, patch: { title: e.currentTarget.value } },
              ]);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditingTitle(false);
          }}
          className="nodrag nopan w-full rounded-sm border border-focus bg-raised px-1 text-sm font-medium text-fg focus-self"
        />
      ) : (
        <h4
          onClick={() => setEditingTitle(true)}
          className="nodrag cursor-text text-sm font-medium leading-snug text-fg"
        >
          {object.title || "Untitled"}
        </h4>
      )}
      <div className="lod-body mt-2">
        {primitives.length === 0 ? (
          <EmptyHint>No elements yet</EmptyHint>
        ) : (
          <>
            {/*
              A screen, not a diagram: a raised panel on the card's surface, on a 12-column
              grid. Elements carry their own label, because an unlabelled grey block tells
              you a button exists but never which button.
            */}
            <Expanded.Provider value={expanded}>
              <div className="grid grid-cols-12 items-center gap-1.5 rounded-sm border border-subtle bg-raised p-2">
                {shown.map((p) => (
                  <Block key={p.id} primitive={p} />
                ))}
              </div>
            </Expanded.Provider>
            <ExpandToggle
              expanded={expanded}
              hiddenCount={overflow}
              canExpand={primitives.some((p) => (p.label?.length ?? 0) > 18)}
              onToggle={() => setExpanded((e) => !e)}
              moreLabel="elements"
            />
          </>
        )}
      </div>
    </>
  );
}

function Block({ primitive }: { primitive: Primitive }) {
  const span = Math.min(12, Math.max(1, primitive.span || 12));
  return (
    <div
      // `min-w-0` is load-bearing: a grid item defaults to `min-width: auto`, which refuses to
      // shrink below its content, so without it a long label on a narrow span overflows the
      // column and spills outside the card instead of truncating.
      className="min-w-0"
      style={{ gridColumn: `span ${span} / span ${span}` }}
      title={primitive.label}
    >
      <Shape primitive={primitive} />
    </div>
  );
}

/** Two muted bars — what an element looks like before anyone has said what it says. */
function Placeholder({ lines = 2 }: { lines?: number }) {
  return (
    <div className="space-y-[3px] py-[3px]">
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="h-[3px] rounded-full bg-active"
          style={{ width: i === lines - 1 ? "60%" : "100%" }}
        />
      ))}
    </div>
  );
}

function Shape({ primitive }: { primitive: Primitive }) {
  const label = primitive.label?.trim();
  const expanded = useContext(Expanded);
  /** Collapsed cards clip to keep every card the same size; expanded ones show everything. */
  const clip = expanded ? "" : "truncate";

  switch (primitive.kind) {
    case "heading":
      return label ? (
        <p className={`text-xs font-medium leading-snug text-fg ${clip}`}>{label}</p>
      ) : (
        <div className="h-[5px] w-3/4 rounded-full bg-[var(--border-strong)]" />
      );

    case "text":
      return label ? (
        <p
          className={
            "text-2xs leading-snug text-fg-secondary " + (expanded ? "" : "line-clamp-2")
          }
        >
          {label}
        </p>
      ) : (
        <Placeholder />
      );

    case "box":
      return (
        <div className="grid min-h-6 place-items-center rounded-xs border border-subtle bg-inset px-1 py-1">
          {label && <span className={`max-w-full text-2xs text-fg-tertiary ${clip}`}>{label}</span>}
        </div>
      );

    case "image":
      return (
        <div className="grid min-h-8 place-items-center rounded-xs border border-subtle bg-inset">
          <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden className="text-fg-tertiary">
            <rect
              x="0.7"
              y="0.7"
              width="14.6"
              height="12.6"
              rx="1.6"
              stroke="currentColor"
              strokeWidth="1.1"
              fill="none"
            />
            <circle cx="5" cy="4.6" r="1.3" fill="currentColor" />
            <path
              d="M1.6 11.2 5.6 7.4l3 2.6 2.3-1.9 3.5 3.1"
              stroke="currentColor"
              strokeWidth="1.1"
              fill="none"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      );

    case "avatar":
      return (
        <div className="flex items-center gap-1.5">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-subtle bg-inset text-2xs text-fg-tertiary">
            {label ? label.charAt(0).toUpperCase() : ""}
          </span>
          {label && <span className={`min-w-0 text-2xs text-fg-secondary ${clip}`}>{label}</span>}
        </div>
      );

    case "input":
      return (
        <div className="flex h-5 items-center rounded-xs border border-default bg-inset px-1.5">
          {label ? (
            <span className={`min-w-0 text-2xs text-fg-tertiary ${clip}`}>{label}</span>
          ) : (
            <span className="h-[3px] w-1/3 rounded-full bg-active" />
          )}
        </div>
      );

    case "button":
      return (
        <div className="grid h-5 place-items-center rounded-xs border border-strong bg-active px-1.5">
          {label ? (
            <span className={`max-w-full text-2xs font-medium text-fg ${clip}`}>{label}</span>
          ) : (
            <span className="h-[3px] w-1/2 rounded-full bg-[var(--border-strong)]" />
          )}
        </div>
      );

    case "checkbox":
      return (
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 shrink-0 rounded-[2px] border border-strong bg-inset" />
          {label ? (
            <span className={`min-w-0 text-2xs text-fg-secondary ${clip}`}>{label}</span>
          ) : (
            <span className="h-[3px] flex-1 rounded-full bg-active" />
          )}
        </div>
      );

    case "toggle":
      return (
        <div className="flex items-center gap-1.5">
          <span className="flex h-3 w-5 shrink-0 items-center rounded-full border border-strong bg-inset px-[2px]">
            <span className="h-2 w-2 rounded-full bg-[var(--border-strong)]" />
          </span>
          {label ? (
            <span className={`min-w-0 text-2xs text-fg-secondary ${clip}`}>{label}</span>
          ) : (
            <span className="h-[3px] flex-1 rounded-full bg-active" />
          )}
        </div>
      );

    case "badge":
      return (
        <div className="flex">
          <span className="max-w-full rounded-full border border-subtle bg-inset px-1.5 py-[1px] text-2xs text-fg-secondary">
            {label || "—"}
          </span>
        </div>
      );

    case "list":
      return (
        <div className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-xs border border-subtle bg-inset">
          {label ? (
            <>
              <p className={`px-1.5 py-[3px] text-2xs text-fg-secondary ${clip}`}>{label}</p>
              <div className="px-1.5 py-1">
                <Placeholder lines={2} />
              </div>
            </>
          ) : (
            <div className="px-1.5 py-1">
              <Placeholder lines={3} />
            </div>
          )}
        </div>
      );

    case "divider":
      return <div className="h-px w-full bg-[var(--border-default)]" />;
  }
}
