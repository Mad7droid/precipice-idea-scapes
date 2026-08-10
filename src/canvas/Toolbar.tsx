import { useState } from "react";
import { allPlugins } from "@/core/registry";
import { LAYOUT_LABELS, type EdgeMode, type LayoutMode } from "@/starters";

/**
 * The canvas utility rail.
 *
 * Add, view, undo/redo, zoom, fit and tidy. Tidy grew a menu when layout stopped being one
 * left-to-right pass: the scape's starter picks the default arrangement, and this is where you
 * override it for a scape that turned out to be a different shape than it started as.
 */
export interface ToolbarProps {
  edgeMode: EdgeMode;
  onEdgeModeChange: (mode: EdgeMode) => void;
  hiddenTypes: Set<string>;
  onToggleType: (type: string) => void;
  layoutMode: LayoutMode;
  onTidy: (mode: LayoutMode) => void;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onFit: () => void;
  onAdd: (position: { x: number; y: number }) => void;
  onHelp: () => void;
  /**
   * Another tab holds this scape. The controls that change the document are removed rather
   * than disabled: a row of greyed-out buttons is a worse explanation of why you cannot edit
   * than the strip over the canvas that says so in words.
   */
  readOnly?: boolean;
}

export function Toolbar({
  edgeMode,
  onEdgeModeChange,
  hiddenTypes,
  onToggleType,
  layoutMode,
  onTidy,
  zoom,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onFit,
  onAdd,
  onHelp,
  readOnly = false,
}: ToolbarProps) {
  const [viewOpen, setViewOpen] = useState(false);

  return (
    <div className="absolute bottom-4 right-4 z-panel flex flex-col items-end gap-1.5">
      {viewOpen && (
        <Menu onClose={() => setViewOpen(false)}>
          <p className="mono px-2 py-1">Lines</p>
          {(
            [
              ["all", "All"],
              ["selected", "Only for selection"],
              ["none", "Off"],
            ] as const
          ).map(([mode, label]) => (
            <MenuItem key={mode} onClick={() => onEdgeModeChange(mode)}>
              <Tick on={edgeMode === mode} />
              {label}
            </MenuItem>
          ))}

          <p className="mono mt-1 border-t border-subtle px-2 pb-1 pt-2">Show</p>
          {allPlugins().map((plugin) => (
            <MenuItem key={plugin.type} onClick={() => onToggleType(plugin.type)}>
              <Tick on={!hiddenTypes.has(plugin.type)} />
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: `var(${plugin.color})` }}
              />
              {plugin.label}
            </MenuItem>
          ))}
        </Menu>
      )}

      <div className="flex flex-col overflow-hidden rounded-md border border-subtle bg-surface shadow-sm">
        {!readOnly && (
          <ToolButton
            label="Add object (N, J, W)"
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              onAdd({ x: bounds.right, y: bounds.bottom });
            }}
          >
            <path d="M7 2.5v9M2.5 7h9" strokeLinecap="round" />
          </ToolButton>
        )}
        <ToolButton label="Help and keyboard shortcuts (?)" onClick={onHelp}>
          <circle cx="7" cy="7" r="5.5" />
          <path d="M5.6 5.4a1.55 1.55 0 1 1 2.75 1c-.56.7-1.35.9-1.35 1.85" strokeLinecap="round" />
          <path d="M7 10.3h.01" strokeLinecap="round" strokeWidth="2" />
        </ToolButton>
        <ToolButton
          label={`View — lines ${edgeMode === "none" ? "off" : edgeMode}`}
          onClick={() => {
            setViewOpen((open) => !open);
          }}
        >
          <path d="M1 7s2.2-3.8 6-3.8S13 7 13 7s-2.2 3.8-6 3.8S1 7 1 7Z" strokeLinejoin="round" />
          <circle cx="7" cy="7" r="1.6" />
        </ToolButton>

        <Divider />

        {!readOnly && (
          <>
            <ToolButton label="Undo (⌘Z)" onClick={onUndo} disabled={!canUndo}>
              <path d="M3 6.5h5.2a2.8 2.8 0 0 1 0 5.6H5.5" strokeLinecap="round" />
              <path d="M5.2 3.6 2.4 6.5l2.8 2.9" strokeLinecap="round" strokeLinejoin="round" />
            </ToolButton>
            <ToolButton label="Redo (⇧⌘Z)" onClick={onRedo} disabled={!canRedo}>
              <path d="M11 6.5H5.8a2.8 2.8 0 0 0 0 5.6h2.7" strokeLinecap="round" />
              <path d="M8.8 3.6l2.8 2.9-2.8 2.9" strokeLinecap="round" strokeLinejoin="round" />
            </ToolButton>

            <Divider />
          </>
        )}

        <ToolButton label="Zoom in" onClick={onZoomIn}>
          <path d="M7 3.5v7M3.5 7h7" strokeLinecap="round" />
        </ToolButton>
        <button
          type="button"
          title="Reset zoom to 100% (0)"
          onClick={onZoomReset}
          className="mono px-1 py-1 text-center transition-colors duration-instant ease-out hover:bg-hover hover:text-fg"
        >
          {Math.round(zoom * 100)}
        </button>
        <ToolButton label="Zoom out" onClick={onZoomOut}>
          <path d="M3.5 7h7" strokeLinecap="round" />
        </ToolButton>

        <Divider />

        <ToolButton label="Fit view (⇧1)" onClick={onFit}>
          <path d="M1.5 5V1.5h3.5M12.5 5V1.5H9M1.5 9v3.5h3.5M12.5 9v3.5H9" />
        </ToolButton>
        {!readOnly && (
          <ToolButton
            label={`Tidy ${LAYOUT_LABELS[layoutMode].toLowerCase()}`}
            onClick={() => onTidy(layoutMode)}
          >
            <path d="M2 2.5h4v3.5H2zM8 2.5h4v9H8zM2 8h4v3.5H2z" strokeLinejoin="round" />
          </ToolButton>
        )}
      </div>
    </div>
  );
}

function Menu({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="mb-0.5 w-56 rounded-md border border-subtle bg-surface p-1 shadow-lg"
      onMouseLeave={onClose}
    >
      {children}
    </div>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-fg transition-colors duration-instant ease-out hover:bg-hover"
    >
      {children}
    </button>
  );
}

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={
        "grid h-8 w-8 place-items-center transition-colors duration-instant ease-out " +
        "disabled:pointer-events-none disabled:opacity-30 " +
        "text-fg-secondary hover:bg-hover hover:text-fg"
      }
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        aria-hidden
      >
        {children}
      </svg>
    </button>
  );
}

function Divider() {
  return <span className="h-px bg-[var(--border-subtle)]" aria-hidden />;
}

function Tick({ on }: { on: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="shrink-0">
      {on && (
        <path
          d="M2.5 6.2l2.4 2.4 4.6-5"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
