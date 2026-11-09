import { afterEach, describe, expect, it } from "vitest";
import { render } from "@/test/react";
import { HelpPanel } from "./ProductivityOverlays";

const original = window.matchMedia;
afterEach(() => {
  window.matchMedia = original;
});

function pointer(coarse: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: coarse && query === "(pointer: coarse)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

const tabs = () =>
  [...document.querySelectorAll("[aria-label='Help sections'] button")].map((b) => b.textContent);

describe("Help on touch screens", () => {
  it("lists touch gestures only where there is a touch screen", () => {
    pointer(true);
    const touch = render(<HelpPanel onClose={() => {}} initialSection="gestures" />);
    expect(tabs()).toContain("Touch gestures");
    expect(document.body.textContent).toContain("Tap with two fingers");
    // An iPad may have a keyboard attached.
    expect(tabs()).toContain("Keyboard shortcuts");
    touch.unmount();

    pointer(false);
    const mouse = render(<HelpPanel onClose={() => {}} />);
    expect(tabs()).not.toContain("Touch gestures");
    mouse.unmount();
  });
});
