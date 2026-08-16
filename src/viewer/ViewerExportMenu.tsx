import { useRef, useState } from "react";
import { Menu, MenuItem } from "@/design/Menu";
import type { PublishedScape } from "@/publish/contract";
import { exportPublication, type ViewerExportFormat } from "./export";

/**
 * The editor's export menu, on the public page.
 *
 * Same two formats, same captions, same order, so a reader who later becomes an author finds
 * the thing where they left it. What is different is the failure channel: there is no toast
 * host here — the viewer deliberately ships none of the editor's chrome — so a failed render
 * says so in place, under the button that caused it.
 */
export function ViewerExportMenu({ scape }: { scape: PublishedScape }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boundary = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const choose = async (format: ViewerExportFormat) => {
    setOpen(false);
    setError(null);
    if (format === "scape") {
      try {
        await exportPublication(scape, "scape");
      } catch {
        setError("Could not export the file.");
      }
      return;
    }

    // A PDF of a large scape takes a beat, and a button that looks idle while it renders lies.
    setBusy(true);
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    try {
      await exportPublication(scape, "pdf");
    } catch {
      setError("Could not export the PDF. Try the scape file instead.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={boundary} className="pointer-events-auto relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy}
        disabled={busy}
        onClick={() => setOpen((was) => !was)}
        className="flex items-center gap-1.5 rounded-lg border border-border-default bg-surface px-3 py-2 text-xs font-medium text-fg-secondary shadow-md transition-colors hover:bg-hover hover:text-fg disabled:opacity-60 disabled:hover:bg-surface"
      >
        {busy ? "Exporting…" : "Export"}
        {!busy && (
          <svg width="8" height="5" viewBox="0 0 8 5" fill="none" aria-hidden>
            <path
              d="m1 1 3 3 3-3"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      <div className="absolute right-0 top-full z-popover mt-1">
        <Menu
          open={open}
          label="Export"
          boundaryRef={boundary}
          onClose={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        >
          <MenuItem onSelect={() => void choose("scape")} caption="Re-opens in Precipice">
            Scape file
          </MenuItem>
          <MenuItem onSelect={() => void choose("pdf")} caption="Diagram and written outline">
            PDF
          </MenuItem>
        </Menu>
      </div>

      {error && (
        <p role="alert" className="absolute right-0 top-full mt-1 w-56 text-2xs text-fg-tertiary">
          {error}
        </p>
      )}
    </div>
  );
}
