import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "@/test/react";
import { useInputMode, useLayoutClass } from "./useLayout";

function Probe() {
  return (
    <span>
      {useLayoutClass()}/{useInputMode()}
    </span>
  );
}

const originalWidth = window.innerWidth;
const originalMatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
  window.matchMedia = originalMatchMedia;
});

describe("useLayout", () => {
  it("tracks width across resizes", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    const { container, unmount } = render(<Probe />);
    expect(container.textContent).toBe("compact/fine");

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(container.textContent).toBe("expanded/fine");
    unmount();
  });

  it("reads the input mode from the pointer media query, not the width", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    window.matchMedia = ((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    const { container, unmount } = render(<Probe />);
    expect(container.textContent).toBe("expanded/coarse");
    unmount();
  });
});
