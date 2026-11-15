import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, type as typeInto } from "@/test/react";
import { useDebouncedText } from "./ui";

function Field({ commit }: { commit: (next: string) => void }) {
  const [draft, onChange] = useDebouncedText("", commit);
  return <input aria-label="Title" value={draft} onChange={(e) => onChange(e.target.value)} />;
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
}

describe("useDebouncedText on a phone", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

  it("commits the draft as soon as the page is hidden, before the debounce", () => {
    const commit = vi.fn();
    const { container, unmount } = render(<Field commit={commit} />);
    typeInto(container.querySelector("input")!, "Onboard");
    expect(commit).not.toHaveBeenCalled();

    setHidden(true);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(commit).toHaveBeenCalledWith("Onboard");

    act(() => void vi.advanceTimersByTime(500));
    expect(commit).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("runs ahead of listeners registered earlier on document", () => {
    const order: string[] = [];
    const autosave = () => order.push("autosave");
    document.addEventListener("visibilitychange", autosave);
    const { container, unmount } = render(<Field commit={() => order.push("commit")} />);
    typeInto(container.querySelector("input")!, "x");

    setHidden(true);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(order).toEqual(["commit", "autosave"]);
    document.removeEventListener("visibilitychange", autosave);
    unmount();
  });

  it("commits on pagehide too", () => {
    const commit = vi.fn();
    const { container, unmount } = render(<Field commit={commit} />);
    typeInto(container.querySelector("input")!, "Draft");
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(commit).toHaveBeenCalledWith("Draft");
    unmount();
  });
});
