import { clampPanel, PANEL } from "./layout";

/**
 * A focusable splitter between the canvas and a side panel. Pointer drag and arrow keys both
 * resize; Home/End jump to the limits.
 */
export function PanelResizer({
  side,
  label,
  width,
  onResize,
}: {
  /** Which panel this resizes. The left panel grows rightwards, the right one leftwards. */
  side: "left" | "right";
  label: string;
  width: number;
  onResize: (width: number) => void;
}) {
  const direction = side === "left" ? 1 : -1;

  const onPointerDown = (event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const onMove = (move: PointerEvent) =>
      onResize(clampPanel(startWidth + direction * (move.clientX - startX)));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    let next: number | null = null;
    if (event.key === "ArrowRight") next = width + direction * PANEL.step;
    else if (event.key === "ArrowLeft") next = width - direction * PANEL.step;
    else if (event.key === "Home") next = PANEL.min;
    else if (event.key === "End") next = PANEL.max;
    if (next === null) return;
    event.preventDefault();
    onResize(clampPanel(next));
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={PANEL.min}
      aria-valuemax={PANEL.max}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={
        "focus-self absolute top-0 z-panel h-full w-1 cursor-col-resize transition-colors " +
        "hover:bg-accent/40 focus-visible:bg-accent/40 " +
        (side === "left" ? "right-0" : "left-0")
      }
    />
  );
}
