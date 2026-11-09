import { describe, expect, it } from "vitest";
import {
  BREAKPOINTS,
  GESTURES,
  SHEET_PEEK_MIN,
  layoutClassFor,
  resolveSheetSnap,
  sheetHeightFor,
} from "./viewport";
import tailwind from "../../tailwind.config";

describe("layoutClassFor", () => {
  it("classifies by lower bounds", () => {
    expect(layoutClassFor(320)).toBe("compact");
    expect(layoutClassFor(639)).toBe("compact");
    expect(layoutClassFor(640)).toBe("medium");
    expect(layoutClassFor(1023)).toBe("medium");
    expect(layoutClassFor(1024)).toBe("expanded");
  });

  it("falls back to compact for nonsense", () => {
    expect(layoutClassFor(Number.NaN)).toBe("compact");
  });

  it("agrees with the Tailwind screens", () => {
    const screens = tailwind.theme?.extend?.screens as Record<string, unknown>;
    expect(screens.medium).toBe(`${BREAKPOINTS.medium}px`);
    expect(screens.expanded).toBe(`${BREAKPOINTS.expanded}px`);
  });
});

describe("sheets", () => {
  const vh = 800;

  it("never lets peek go below its minimum", () => {
    expect(sheetHeightFor("peek", 300)).toBe(SHEET_PEEK_MIN);
    expect(sheetHeightFor("closed", vh)).toBe(0);
  });

  it("lands on the nearest snap on a slow release", () => {
    expect(resolveSheetSnap(390, 0, vh, ["peek", "half", "full"])).toBe("half");
    expect(resolveSheetSnap(700, 0.1, vh, ["peek", "half", "full"])).toBe("full");
  });

  it("follows a flick one step", () => {
    expect(resolveSheetSnap(700, 0.8, vh, ["peek", "half", "full"])).toBe("half");
    expect(resolveSheetSnap(420, -0.8, vh, ["peek", "half", "full"])).toBe("full");
  });

  it("dismisses on a downward flick only when closing is allowed", () => {
    expect(resolveSheetSnap(100, 0.9, vh, ["closed", "peek", "half"])).toBe("closed");
    expect(resolveSheetSnap(100, 0.9, vh, ["peek", "half"])).toBe("peek");
  });
});

describe("gesture table", () => {
  it("gives every non-manipulation gesture a visible alternative", () => {
    const manipulation = /pan|zoom|move|select|open/;
    for (const spec of GESTURES) {
      if (spec.visibleAlternative === null) expect(spec.result).toMatch(manipulation);
    }
  });

  it("claims no screen-edge or multi-finger-swipe gestures", () => {
    for (const spec of GESTURES) {
      expect(spec.gesture).not.toMatch(/edge|three-finger|four-finger/);
    }
  });
});
