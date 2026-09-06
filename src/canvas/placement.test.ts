import { describe, expect, it } from "vitest";
import { fixtureScape } from "@/core/fixtures";
import { freePosition } from "./placement";
import { objectWidth, widthFor } from "./layout";

describe("manual block placement", () => {
  it("leaves existing blocks untouched and avoids measured large cards", () => {
    const scape = fixtureScape();
    const before = JSON.stringify(scape);
    const measured = Object.fromEntries(
      scape.objectOrder.map((id) => [id, { width: objectWidth(scape.objects[id]), height: 800 }]),
    );
    const first = scape.objects[scape.objectOrder[0]];
    const next = freePosition(scape, "wireframe", first, measured);
    for (const id of scape.objectOrder) {
      const other = scape.objects[id];
      expect(
        next.x + widthFor("wireframe") <= other.x ||
          other.x + measured[id].width <= next.x ||
          next.y + 220 <= other.y ||
          other.y + 800 <= next.y,
      ).toBe(true);
    }
    expect(JSON.stringify(scape)).toBe(before);
  });
  it("keeps the requested location when it is free", () => {
    expect(freePosition(fixtureScape(), "note", { x: -10000, y: -10000 })).toEqual({
      x: -10000,
      y: -10000,
    });
  });
});
