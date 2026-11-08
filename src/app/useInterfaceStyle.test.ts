import { afterEach, expect, it, vi } from "vitest";
import { useNotifications } from "@/core/notify";

afterEach(() => {
  vi.restoreAllMocks();
  useNotifications.setState({ toasts: [] });
  delete document.documentElement.dataset.interfaceStyle;
});

it("serializes style saves and restores the last durable choice after a failed save", async () => {
  vi.resetModules();
  localStorage.clear();
  const { setInterfaceStyle } = await import("./useInterfaceStyle");
  const { settingsRepository: repository } = await import("@/persistence/settings");
  let finish!: () => void;
  const save = vi
    .spyOn(repository, "set")
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error("Storage unavailable"))
    .mockResolvedValueOnce(undefined);
  const first = setInterfaceStyle("graphite");
  const second = setInterfaceStyle("field");
  await Promise.resolve();
  expect(save).toHaveBeenCalledTimes(1);
  expect(document.documentElement.dataset.interfaceStyle).toBe("field");
  finish();
  await Promise.all([first, second]);
  expect(document.documentElement.dataset.interfaceStyle).toBe("graphite");
  await setInterfaceStyle("current");
  expect(save).toHaveBeenCalledTimes(3);
  expect(document.documentElement.dataset.interfaceStyle).toBe("current");
});
