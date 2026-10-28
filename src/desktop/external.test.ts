import { afterEach, describe, expect, it, vi } from "vitest";
import { externalWebUrl, installExternalLinks } from "@/desktop/external";

describe("external links", () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    document.body.innerHTML = "";
  });

  it("only lets credential-free http(s) URLs leave the app", () => {
    expect(externalWebUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(externalWebUrl("javascript:alert(1)")).toBeNull();
    expect(externalWebUrl("file:///etc/passwd")).toBeNull();
    expect(externalWebUrl("https://u:p@example.com")).toBeNull();
    expect(externalWebUrl(null)).toBeNull();
  });

  it("routes target=_blank web anchors to the native opener", () => {
    const invoke = vi.fn(async () => undefined);
    uninstall = installExternalLinks(invoke);
    document.body.innerHTML = `<a target="_blank" href="https://example.com/x"><span>go</span></a>`;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.querySelector("span")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(invoke).toHaveBeenCalledWith("https://example.com/x");
  });

  it("leaves same-window, download and non-web anchors alone", () => {
    const invoke = vi.fn(async () => undefined);
    uninstall = installExternalLinks(invoke);
    document.body.innerHTML = `<a id="a" href="https://example.com"></a><a id="b" target="_blank" href="mailto:x@y.z"></a><a id="c" target="_blank" download href="blob:x"></a>`;
    const seen: boolean[] = [];
    const record = (event: Event) => {
      seen.push(event.defaultPrevented);
      event.preventDefault(); // jsdom cannot navigate
    };
    document.addEventListener("click", record);
    for (const id of ["a", "b", "c"])
      document
        .getElementById(id)!
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    document.removeEventListener("click", record);
    expect(seen).toEqual([false, false, false]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("patches window.open for web URLs and restores it", () => {
    const invoke = vi.fn(async () => undefined);
    const original = window.open;
    uninstall = installExternalLinks(invoke);
    expect(window.open("https://example.com/p", "_blank", "noopener")).toBeNull();
    expect(invoke).toHaveBeenCalledWith("https://example.com/p");
    uninstall();
    uninstall = undefined;
    expect(window.open).toBe(original);
  });
});
