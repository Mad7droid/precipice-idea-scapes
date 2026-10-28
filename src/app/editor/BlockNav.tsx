import { allPlugins } from "@/core/registry";

export const BLOCK_SHORTCUTS: Record<string, string> = {
  note: "N",
  journey: "J",
  wireframe: "W",
  scape: "S",
};

/** A compact creation rail: it expands naturally as the object registry grows. */
export function BlockNav({ onAdd }: { onAdd: (type: string) => void }) {
  const plugins = allPlugins();

  return (
    <nav
      aria-label="Add building block"
      className="flex w-11 shrink-0 flex-col items-center gap-1 border-l border-subtle bg-surface px-1 py-2"
    >
      {plugins.map((plugin) => {
        const shortcut = BLOCK_SHORTCUTS[plugin.type];
        const label = `Add ${plugin.label}${shortcut ? ` (${shortcut})` : ""}`;
        return (
          <button
            key={plugin.type}
            type="button"
            aria-label={label}
            onClick={() => onAdd(plugin.type)}
            className="group relative grid h-8 w-8 place-items-center rounded-sm text-fg-secondary transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
          >
            <BlockIcon type={plugin.type} color={plugin.color} />
            <span className="pointer-events-none absolute left-[calc(100%+6px)] top-1/2 z-popover -translate-y-1/2 whitespace-nowrap rounded-sm border border-subtle bg-raised px-2 py-1 text-xs text-fg opacity-0 shadow-md transition-opacity duration-instant ease-out group-hover:opacity-100 group-focus-visible:opacity-100">
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

export function BlockIcon({ type, color }: { type: string; color: string }) {
  const stroke = `var(${color})`;
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
      {type === "note" && (
        <path
          d="M3 2.5h8l3 3v9H3v-12ZM11 2.5v3h3"
          stroke={stroke}
          strokeWidth="1.25"
          strokeLinejoin="round"
        />
      )}
      {type === "journey" && (
        <path
          d="M3 4h4m3 0h4M5 2v4m7-4v4M3 13h4m3 0h4M5 11v4m7-4v4M7 4h3M7 13h3"
          stroke={stroke}
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      )}
      {type === "wireframe" && (
        <path
          d="M2.5 3h12v11h-12zM2.5 6h12M5 8.5h2.5M5 11h6.5"
          stroke={stroke}
          strokeWidth="1.25"
          strokeLinejoin="round"
        />
      )}
      {type === "scape" && (
        <path
          d="M3.5 2.5h10v12h-10zM6 5.5h5M6 8h5M6 10.5h3"
          stroke={stroke}
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {!["note", "journey", "wireframe", "scape"].includes(type) && (
        <circle cx="8.5" cy="8.5" r="4.5" fill={stroke} />
      )}
    </svg>
  );
}
