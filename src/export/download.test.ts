import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadBlob, filenameFor } from "@/export/download";

describe("filenameFor", () => {
  it("keeps letters in any script and strips unsafe characters", () => {
    expect(filenameFor("Onboarding Flow!")).toBe("onboarding-flow");
    expect(filenameFor("Café / plan")).toBe("café-plan");
    expect(filenameFor("日本語のメモ")).toBe("日本語のメモ");
    expect(filenameFor("../..")).toBe("scape");
  });
});

describe("downloadBlob", () => {
  afterEach(() => vi.useRealTimers());
  it("revokes the object URL only after the download has started", () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: revoke });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadBlob(new Blob(["x"]), "x.scape");
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith("blob:x");
    vi.unstubAllGlobals();
  });
});
