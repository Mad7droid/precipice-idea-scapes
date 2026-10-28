import { describe, expect, it, vi } from "vitest";
import { registerQuitFlush, runQuitFlushes } from "@/desktop/quit";

describe("quit flush registry", () => {
  it("runs every registered flush even when one fails, and unregisters", async () => {
    const good = vi.fn(async () => undefined);
    const bad = vi.fn(async () => {
      throw new Error("disk");
    });
    const offGood = registerQuitFlush(good);
    const offBad = registerQuitFlush(bad);
    await runQuitFlushes();
    expect(good).toHaveBeenCalledOnce();
    expect(bad).toHaveBeenCalledOnce();
    offGood();
    offBad();
    await runQuitFlushes();
    expect(good).toHaveBeenCalledOnce();
  });
});
