import type { Scape } from "@/core/types";
import { objectWidth, widthFor } from "./layout";

type Point = { x: number; y: number };
type Size = { width: number; height: number };

/** Find nearby free space without moving any existing work. Returns the card's top-left. */
export function freePosition(
  scape: Scape,
  type: string,
  preferred: Point,
  measured: Record<string, Size> = {},
): Point {
  const width = widthFor(type);
  const height = 220;
  const gap = 32;
  const boxes = scape.objectOrder.map((id) => {
    const object = scape.objects[id];
    return {
      x: object.x,
      y: object.y,
      width: measured[id]?.width ?? objectWidth(object),
      height: measured[id]?.height ?? 220,
    };
  });
  const candidates = [
    preferred,
    ...boxes.flatMap((box) => [
      { x: box.x + box.width + gap, y: box.y },
      { x: box.x, y: box.y + box.height + gap },
      { x: box.x - width - gap, y: box.y },
      { x: box.x, y: box.y - height - gap },
    ]),
  ];
  candidates.sort(
    (a, b) =>
      Math.hypot(a.x - preferred.x, a.y - preferred.y) -
      Math.hypot(b.x - preferred.x, b.y - preferred.y),
  );
  return (
    candidates.find((p) =>
      boxes.every(
        (b) =>
          p.x + width + gap <= b.x ||
          b.x + b.width + gap <= p.x ||
          p.y + height + gap <= b.y ||
          b.y + b.height + gap <= p.y,
      ),
    ) ?? { x: Math.max(preferred.x, ...boxes.map((b) => b.x + b.width + gap)), y: preferred.y }
  );
}
