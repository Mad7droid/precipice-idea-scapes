import { expect, it, vi } from "vitest";
import { publicationUrl } from "@/publish/url";

it.each(["tauri://localhost", "http://localhost:1420", "https://precipice.pages.dev"])(
  "shares the hosted viewer when running at %s",
  (origin) => {
    vi.stubGlobal("location", { origin });
    try {
      expect(publicationUrl("/p/pub_example")).toBe("https://precipice.pages.dev/p/pub_example");
    } finally {
      vi.unstubAllGlobals();
    }
  },
);
