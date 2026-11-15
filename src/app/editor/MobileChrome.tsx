import { allPlugins } from "@/core/registry";
import { BlockIcon } from "./BlockNav";

/**
 * The compact layout's bottom action bar.
 *
 * On a phone the outline rail, the block rail and the inspector column all disappear: the
 * canvas is full-bleed and everything else lives in sheets. This bar is how you reach them.
 * Undo and Redo are here rather than only in the canvas toolbar because the two-finger-tap
 * gesture needs a visible twin (see GESTURES in src/core/viewport.ts).
 *
 * Labelled icons, not bare ones: a phone has no hover to explain a glyph.
 */
export function MobileActionBar({
  onOutline,
  onAdd,
  onAsk,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  readOnly,
}: {
  onOutline: () => void;
  onAdd: () => void;
  onAsk: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  readOnly: boolean;
}) {
  return (
    <nav
      aria-label="Editor actions"
      className="flex shrink-0 items-stretch justify-around border-t border-subtle bg-surface pb-safe-bottom pl-safe-left pr-safe-right"
    >
      <BarButton label="Outline" onClick={onOutline}>
        <path d="M3 4.5h11M3 8.5h11M3 12.5h7" />
      </BarButton>
      {!readOnly && (
        <BarButton label="Add" onClick={onAdd}>
          <path d="M8.5 3v11M3 8.5h11" />
        </BarButton>
      )}
      {!readOnly && (
        <BarButton label="Ask" onClick={onAsk}>
          <path d="M8.5 2.5v2M8.5 12.5v2M2.5 8.5h2M12.5 8.5h2M4.3 4.3l1.4 1.4M11.3 11.3l1.4 1.4M12.7 4.3l-1.4 1.4M5.7 11.3l-1.4 1.4" />
        </BarButton>
      )}
      <BarButton label="Undo" onClick={onUndo} disabled={readOnly || !canUndo}>
        <path d="M6 4.5 3 7.5l3 3M3.5 7.5h6.5a3.5 3.5 0 0 1 0 7H8" />
      </BarButton>
      <BarButton label="Redo" onClick={onRedo} disabled={readOnly || !canRedo}>
        <path d="m11 4.5 3 3-3 3M13.5 7.5H7a3.5 3.5 0 0 0 0 7h2" />
      </BarButton>
    </nav>
  );
}

function BarButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-hit min-w-hit flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-2xs text-fg-secondary transition-colors duration-instant ease-out active:bg-active disabled:opacity-40"
    >
      <svg
        aria-hidden
        width="17"
        height="17"
        viewBox="0 0 17 17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
      {label}
    </button>
  );
}

/** The Add sheet's body: one large row per block type, same registry as the desktop rail. */
export function AddBlockList({ onAdd }: { onAdd: (type: string) => void }) {
  return (
    <ul className="flex flex-col gap-1 pt-1">
      {allPlugins().map((plugin) => (
        <li key={plugin.type}>
          <button
            type="button"
            onClick={() => onAdd(plugin.type)}
            className="flex min-h-hit w-full items-center gap-3 rounded-md px-2 text-left text-base text-fg transition-colors duration-instant ease-out active:bg-active"
          >
            <span className="grid h-8 w-8 place-items-center rounded-sm bg-inset">
              <BlockIcon type={plugin.type} color={plugin.color} />
            </span>
            {plugin.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
