import { beforeEach, expect, it, vi } from "vitest";
import { fixtureScape } from "@/core/fixtures";
import { shareFlowPreview } from "./publish";
import { createPublication, unpublish, republish } from "@/publish/client";
import { hostToken } from "./credential";

vi.mock("./credential", () => ({ hostToken: vi.fn(() => "fictional-host-token") }));
vi.mock("@/publish/client", async (original) => ({
  ...(await original<typeof import("@/publish/client")>()),
  createPublication: vi.fn(async () => ({
    publicationId: "pub_fictional",
    url: "https://precipice.pages.dev/p/pub_fictional",
  })),
  unpublish: vi.fn(async () => ({})),
  republish: vi.fn(async () => ({
    publicationId: "pub_fictional",
    url: "https://precipice.pages.dev/p/pub_fictional",
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hostToken).mockReturnValue("fictional-host-token");
});

it("uses a bounded public projection and the hosted iframe route, with no local-library mutation", async () => {
  const scape = fixtureScape();
  scape.instructions = { body: "private instructions", version: 1 };
  const before = structuredClone(scape);
  const shared = await shareFlowPreview(scape);
  expect(shared.embed_url).toBe("https://precipice.pages.dev/embed/pub_fictional");
  expect(shared.iframe).toContain('referrerpolicy="no-referrer"');
  expect(shared.iframe).not.toContain("tauri:");
  const [projection, options] = vi.mocked(createPublication).mock.calls[0];
  expect(options).toEqual({ token: "fictional-host-token" });
  const payload = JSON.stringify(projection);
  expect(payload).not.toContain("private instructions");
  expect(payload).not.toContain(scape.id);
  expect(payload).not.toContain("fictional-host-token");
  expect(projection.objects).toHaveLength(scape.objectOrder.length);
  expect(scape).toEqual(before);
});

it("withdraws the hosted snapshot and requires an authenticated host to share", async () => {
  await expect(shareFlowPreview(fixtureScape(), "pub_fictional", true)).resolves.toEqual({
    message: "Shared preview withdrawn.",
  });
  expect(unpublish).toHaveBeenCalledWith("pub_fictional", { token: "fictional-host-token" });
  expect(createPublication).not.toHaveBeenCalled();
  vi.mocked(hostToken).mockReturnValue(null);
  await expect(shareFlowPreview(fixtureScape())).rejects.toThrow("Sign in to Precipice");
});

it("restores the same snapshot and iframe URL when a withdrawn draft is shared again", async () => {
  const result = await shareFlowPreview(fixtureScape(), "pub_fictional");
  expect(republish).toHaveBeenCalledWith("pub_fictional", { token: "fictional-host-token" });
  expect(createPublication).not.toHaveBeenCalled();
  expect(result.embed_url).toBe("https://precipice.pages.dev/embed/pub_fictional");
});
