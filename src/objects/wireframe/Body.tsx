import { createContext, useContext } from "react";
import type { ViewObject } from "@/core/viewRegistry";
import { EmptyHint } from "../ui";
import { columnsOf, isSection, type Primitive, type WireframeData } from "./schema";

/**
 * A wireframe's screen, rendered. Shared by the editor's `Node.tsx` and the public viewer.
 *
 * Almost all of this file was already presentational — only the title was ever editable on the
 * card, and the primitives have never been. `onEdit` covers the title; everything below is the
 * same code the editor has always run. See the note plugin's `Body.tsx` for the reasoning.
 */
const Columns = createContext(12);

export function WireframeBody({
  object,
  onEdit,
  renderTitle,
}: {
  object: ViewObject;
  selected?: boolean;
  onEdit?: () => void;
  /** The editor substitutes an input while the title is being edited. The viewer never does. */
  renderTitle?: React.ReactNode;
}) {
  const data = object.data as Partial<WireframeData>;
  const primitives = (data.primitives ?? []).filter(Boolean);
  const columns = columnsOf(data);
  const editable = onEdit ? "nodrag cursor-text" : "";

  return (
    <>
      {renderTitle ?? (
        <h4
          onClick={onEdit}
          className={`text-sm font-medium leading-snug text-fg ${editable}`}
        >
          {object.title || "Untitled"}
        </h4>
      )}
      <div className="mt-2">
        {primitives.length === 0 ? (
          <EmptyHint>No elements yet</EmptyHint>
        ) : (
          /*
            A screen, not a diagram: a raised panel on the card's surface, on a 12-column
            grid. Elements carry their own label, because an unlabelled grey block tells
            you a button exists but never which button.
          */
          <Columns.Provider value={columns}>
            <div
              className="grid items-center gap-1.5 rounded-sm border border-subtle bg-raised p-2"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            >
              {primitives.map((p) => (
                <Block key={p.id} primitive={p} />
              ))}
            </div>
          </Columns.Provider>
        )}
      </div>
    </>
  );
}

const ALIGN: Record<string, string> = {
  start: "justify-self-start",
  center: "justify-self-center",
  end: "justify-self-end",
};

function Block({ primitive }: { primitive: Primitive }) {
  const columns = useContext(Columns);
  // A section is a region header. It always takes the full row, whatever span it carries.
  const span = isSection(primitive)
    ? columns
    : Math.min(columns, Math.max(1, primitive.span || columns));
  const align = primitive.align ? ALIGN[primitive.align] : "";
  return (
    <div
      // `min-w-0` is load-bearing: a grid item defaults to `min-width: auto`, which refuses to
      // shrink below its content, so without it a long label on a narrow span overflows the
      // column and spills outside the card instead of truncating.
      className={`min-w-0 ${align} ${primitive.align ? "" : "w-full"}`}
      style={{ gridColumn: `span ${span} / span ${span}` }}
      title={primitive.label}
    >
      <Shape primitive={primitive} />
    </div>
  );
}

/** Extra vertical weight for the kinds that occupy area rather than a line of text. */
const SIZE: Record<string, string> = { sm: "min-h-5", md: "min-h-10", lg: "min-h-16" };

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
  const weight = primitive.size ? SIZE[primitive.size] : "";

  switch (primitive.kind) {
    // A region within the screen — header, content, footer. Reading a screen is mostly
    // reading its regions, so this is the one element that is typographic, not a shape.
    case "section":
      return (
        <div className="mt-1 flex items-center gap-1.5 first:mt-0">
          <span className="mono shrink-0">{label || "section"}</span>
          <span className="h-px flex-1 bg-[var(--border-subtle)]" />
        </div>
      );

    case "heading":
      return label ? (
        <p className="text-xs font-medium leading-snug text-fg">{label}</p>
      ) : (
        <div className="h-[5px] w-3/4 rounded-full bg-[var(--border-strong)]" />
      );

    case "text":
      return label ? (
        <p className="text-2xs leading-snug text-fg-secondary">{label}</p>
      ) : (
        <Placeholder />
      );

    case "box":
      return (
        <div
          className={`grid min-h-6 place-items-center rounded-xs border border-subtle bg-inset px-1 py-1 ${weight}`}
        >
          {label && <span className="max-w-full text-2xs text-fg-tertiary">{label}</span>}
        </div>
      );

    case "image":
      return (
        <div
          className={`grid min-h-8 place-items-center rounded-xs border border-subtle bg-inset ${weight}`}
        >
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
          {label && <span className="min-w-0 text-2xs text-fg-secondary">{label}</span>}
        </div>
      );

    case "input":
      return (
        <div className="flex h-5 items-center rounded-xs border border-default bg-inset px-1.5">
          {label ? (
            <span className="min-w-0 text-2xs text-fg-tertiary">{label}</span>
          ) : (
            <span className="h-[3px] w-1/3 rounded-full bg-active" />
          )}
        </div>
      );

    case "button":
      return (
        <div className="grid h-5 place-items-center rounded-xs border border-strong bg-active px-1.5">
          {label ? (
            <span className="max-w-full text-2xs font-medium text-fg">{label}</span>
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
            <span className="min-w-0 text-2xs text-fg-secondary">{label}</span>
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
            <span className="min-w-0 text-2xs text-fg-secondary">{label}</span>
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
        <div
          className={`divide-y divide-[var(--border-subtle)] overflow-hidden rounded-xs border border-subtle bg-inset ${weight}`}
        >
          {label ? (
            <>
              <p className="px-1.5 py-[3px] text-2xs text-fg-secondary">{label}</p>
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
