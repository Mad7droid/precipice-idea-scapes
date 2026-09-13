import { describe, it, expect } from "vitest";
import { render } from "@/test/react";
import { Button, buttonClass } from "./Button";

describe("the button primitive", () => {
  it("is the only source of the filled action accent", () => {
    const primary = buttonClass({ variant: "primary" });
    expect(primary).toContain("bg-action-primary");
    expect(primary).toContain("text-fg-on-action-primary");
    // Disabled has to drop the fill, not fade it: a translucent rust on a warm surface
    // still reads as the loudest thing on screen while refusing to be clicked.
    expect(primary).toContain("disabled:bg-inset");
  });

  it("never fills a button with the bright signal accent", () => {
    for (const variant of ["primary", "neutral", "secondary", "ghost", "destructive"] as const) {
      expect(buttonClass({ variant })).not.toContain("bg-accent");
    }
  });

  it("labels a fill from that fill's own token, never from text-on-accent", () => {
    // `--text-on-accent` is tuned for the bright accent and flips to near-black in dark
    // mode. On the deep rust action or on crimson danger it is unreadable.
    for (const variant of ["primary", "destructive"] as const) {
      expect(buttonClass({ variant })).not.toContain("text-fg-on-accent");
    }
    expect(buttonClass({ variant: "destructive" })).toContain("text-fg-inverse");
  });

  it("defaults to a non-submitting button so a dialog control cannot send its form", () => {
    const view = render(<Button>Close</Button>);
    expect(view.container.querySelector("button")!.type).toBe("button");
  });

  it("still lets a caller ask for submit", () => {
    const view = render(<Button type="submit">Save</Button>);
    expect(view.container.querySelector("button")!.type).toBe("submit");
  });

  it("gives Stop a fill that is not the action accent", () => {
    const neutral = buttonClass({ variant: "neutral" });
    expect(neutral).toContain("bg-surface");
    expect(neutral).not.toContain("bg-action-primary");
  });

  it("keeps an icon button square at the size's height", () => {
    expect(buttonClass({ shape: "icon", size: "sm" })).toContain("h-7 w-7");
    expect(buttonClass({ shape: "icon", size: "md" })).toContain("h-8 w-8");
  });
});
