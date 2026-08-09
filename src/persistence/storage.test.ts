import { afterEach, describe, expect, it, vi } from "vitest";
import { notify } from "@/core/notify";
import { requestPersistence, storagePressure, warnIfStorageTight } from "./storage";

/** jsdom has no StorageManager, which is also what an unsupporting browser looks like. */
function withStorage(manager: Partial<StorageManager> | undefined) {
  Object.defineProperty(globalThis.navigator, "storage", {
    value: manager,
    configurable: true,
  });
}

afterEach(() => {
  withStorage(undefined);
  vi.restoreAllMocks();
});

describe("requestPersistence", () => {
  it("reports unsupported rather than throwing where the API is missing", async () => {
    withStorage(undefined);
    await expect(requestPersistence()).resolves.toBe("unsupported");
  });

  it("does not ask again once the origin is already persisted", async () => {
    const persist = vi.fn();
    withStorage({ persisted: async () => true, persist });

    await expect(requestPersistence()).resolves.toBe("persisted");
    // Firefox shows a permission prompt for this. Asking someone who already said yes is how
    // an app teaches people to dismiss its prompts.
    expect(persist).not.toHaveBeenCalled();
  });

  it("asks when the origin is evictable, and reports the answer", async () => {
    withStorage({ persisted: async () => false, persist: async () => true });
    await expect(requestPersistence()).resolves.toBe("persisted");

    withStorage({ persisted: async () => false, persist: async () => false });
    await expect(requestPersistence()).resolves.toBe("denied");
  });

  it("treats a browser that throws as unsupported, not as a failed action", async () => {
    withStorage({
      persisted: async () => {
        throw new Error("nope");
      },
      persist: async () => true,
    });
    await expect(requestPersistence()).resolves.toBe("unsupported");
  });
});

describe("storage pressure", () => {
  it("is null when the browser will not estimate", async () => {
    withStorage({});
    await expect(storagePressure()).resolves.toBeNull();

    withStorage({ estimate: async () => ({ usage: 0, quota: 0 }) });
    await expect(storagePressure()).resolves.toBeNull();
  });

  it("warns only above the threshold, and says what to do about it", async () => {
    const error = vi.spyOn(notify, "error").mockImplementation(() => 0);

    withStorage({ estimate: async () => ({ usage: 50, quota: 100 }) });
    await warnIfStorageTight();
    expect(error).not.toHaveBeenCalled();

    withStorage({ estimate: async () => ({ usage: 95, quota: 100 }) });
    await warnIfStorageTight();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][1]).toMatch(/export/i);
  });
});
