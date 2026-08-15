import type { ScapeObject } from "@/core/types";

export function ObjectChip({ object, onClick }: { object: ScapeObject; onClick?: () => void }) {
  const colour = objectColour(object.type);
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface px-1.5 py-0.5 align-baseline font-sans text-xs text-fg transition-colors duration-instant ease-out hover:bg-hover"
      title={`Select ${object.title} (${object.id})`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${colour}`} />
      <span className="max-w-[12rem] truncate">{object.title}</span>
    </button>
  );
}

function objectColour(type: string): string {
  switch (type) {
    case "note":
      return "bg-obj-note";
    case "journey":
      return "bg-obj-journey";
    case "wireframe":
      return "bg-obj-wireframe";
    default:
      return "bg-fg-tertiary";
  }
}
