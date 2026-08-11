import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ERROR_STATUS, publishedScapeSchema, type PublishedScape } from "@/publish/contract";
import { render } from "@/test/react";
import { loadPublication } from "./api";
import { PublicationCanvas } from "./PublicationCanvas";
import { prepare } from "./publication";
import { parseViewerRoute } from "./route";
import { consumePublicCopy, localCopyFromPublication, stagePublicCopy } from "@/shared/publicCopy";
import {
  ErrorState,
  MissingState,
  UnknownRouteState,
  UnpublishedState,
} from "./states";

/**
 * The whole viewer, exercised against a checked-in publication. No Worker, no Google account,
 * no network — generated once from `src/core/fixtures.ts` through `projectScape`, which is the
 * same path a real publish takes.
 */
const sample: PublishedScape = publishedScapeSchema.parse(
  JSON.parse(
    readFileSync(resolve(__dirname, "fixtures/sample-publication.json"), "utf8"),
  ),
);

const ID = "pub_abcdefghijklmnopqrstuvwxyz";

describe("the sample publication", () => {
  it("parses against the wire contract", () => {
    expect(sample.objects).toHaveLength(12);
    expect(sample.relationships).toHaveLength(12);
  });

  it("carries no local-only field", () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, "fixtures/sample-publication.json"), "utf8"),
    );
    expect(raw).not.toHaveProperty("id");
    expect(raw).not.toHaveProperty("meta");
    expect(raw).not.toHaveProperty("createdAt");
    expect(raw).not.toHaveProperty("updatedAt");
    for (const object of raw.objects) {
      expect(object).not.toHaveProperty("createdAt");
      expect(object).not.toHaveProperty("updatedAt");
    }
  });
});

describe("copying a public scape into the editor", () => {
  it("stages a one-time, local and unpublished copy", () => {
    expect(stagePublicCopy(sample)).toBe(true);
    const staged = consumePublicCopy();
    expect(staged).toEqual(sample);
    expect(consumePublicCopy()).toBeNull();

    const copy = localCopyFromPublication(staged!);
    expect(copy.id).not.toEqual(sample.name);
    expect(copy.name).toBe("Fintech onboarding copy");
    expect(copy.objectOrder).toEqual(sample.objects.map((object) => object.id));
    expect(Object.values(copy.relationships)).toEqual(sample.relationships);
    expect(copy).not.toHaveProperty("publicationId");
  });
});

describe("route parsing", () => {
  it("reads a publication id from a real path, not a hash", () => {
    expect(parseViewerRoute(`/p/${ID}`)).toEqual({
      kind: "publication",
      publicationId: ID,
      embed: false,
    });
    expect(parseViewerRoute(`/embed/${ID}`)).toEqual({
      kind: "publication",
      publicationId: ID,
      embed: true,
    });
  });

  it("tolerates a trailing slash", () => {
    expect(parseViewerRoute(`/p/${ID}/`)).toMatchObject({ publicationId: ID });
  });

  it("rejects anything that is not a publication id", () => {
    for (const path of [
      "/",
      "/p/",
      "/p/not-an-id",
      "/p/pub_TOOSHORT",
      `/p/${ID}/extra`,
      "/s/scp_local",
      `/S/${ID}`,
      "/p/%E0%A4%A",
    ]) {
      expect(parseViewerRoute(path).kind, path).toBe("unknown");
    }
  });
});

describe("loading a publication", () => {
  const pointer = {
    publicationId: ID,
    version: 3,
    hash: "a".repeat(64),
    snapshotPath: `/p/${ID}/v3/scape.json`,
    updatedAt: 1735689600000,
  };

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("follows the pointer to the versioned snapshot", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(pointer))
      .mockResolvedValueOnce(json(sample));

    const result = await loadPublication(ID, fetchImpl as unknown as typeof fetch);

    expect(result).toEqual({ kind: "ok", scape: sample });
    expect(fetchImpl.mock.calls[0][0]).toContain(`/p/${ID}`);
    expect(fetchImpl.mock.calls[1][0]).toContain(`/p/${ID}/v3/scape.json`);
  });

  it("tells 404 and 410 apart, because they mean different things to a reader", async () => {
    const missing = await loadPublication(
      ID,
      vi.fn().mockResolvedValue(new Response(null, { status: ERROR_STATUS.not_found })) as never,
    );
    expect(missing.kind).toBe("missing");

    const unpublished = await loadPublication(
      ID,
      vi.fn().mockResolvedValue(new Response(null, { status: ERROR_STATUS.unpublished })) as never,
    );
    expect(unpublished.kind).toBe("unpublished");
  });

  it("refuses a snapshot path that could leave the API origin", async () => {
    // The pointer comes over the network, so its `snapshotPath` is hostile input even though
    // the server is the one that sent it. Same rule the Worker applies to an OAuth `return`.
    for (const snapshotPath of [
      "https://evil.example/x.json",
      "//evil.example/x.json",
      "/\\evil.example/x.json",
      "/p/../../etc/passwd",
      "x.json",
    ]) {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(json({ ...pointer, snapshotPath }))
        .mockResolvedValueOnce(json(sample));

      const result = await loadPublication(ID, fetchImpl as unknown as typeof fetch);

      expect(result.kind, snapshotPath).toBe("error");
      expect(fetchImpl, snapshotPath).toHaveBeenCalledTimes(1);
    }
  });

  it("reports a snapshot that fails the schema rather than rendering it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(pointer))
      .mockResolvedValueOnce(json({ name: "x", objects: "not an array" }));

    expect((await loadPublication(ID, fetchImpl as unknown as typeof fetch)).kind).toBe("error");
  });

  it("reports a network failure instead of hanging", async () => {
    const result = await loadPublication(ID, vi.fn().mockRejectedValue(new Error("offline")) as never);
    expect(result).toEqual({ kind: "error", detail: "Could not reach the server." });
  });
});

describe("preparing what React Flow draws", () => {
  it("renders every object in the sample", () => {
    const { nodes, edges, dropped } = prepare(sample);
    expect(nodes).toHaveLength(12);
    expect(edges).toHaveLength(12);
    expect(dropped).toBe(0);
  });

  it("uses the author's positions and never lays out", () => {
    const { nodes } = prepare(sample);
    const brief = nodes.find((node) => node.id === "brief")!;
    const source = sample.objects.find((object) => object.id === "brief")!;
    expect(brief.position).toEqual({ x: source.x, y: source.y });
  });

  it("drops an object whose data fails its plugin schema, and counts it", () => {
    const broken: PublishedScape = {
      ...sample,
      objects: [
        ...sample.objects,
        { id: "bad", type: "note", title: "Broken", data: { body: 42 }, x: 0, y: 0 },
      ],
    };
    const { nodes, dropped } = prepare(broken);
    expect(dropped).toBe(1);
    expect(nodes.map((node) => node.id)).not.toContain("bad");
  });

  it("keeps an unknown type so the fallback card can name it", () => {
    const future: PublishedScape = {
      ...sample,
      objects: [
        ...sample.objects,
        { id: "future", type: "hologram", title: "From a newer build", data: {}, x: 0, y: 0 },
      ],
    };
    const { nodes, dropped } = prepare(future);
    expect(dropped).toBe(0);
    expect(nodes.map((node) => node.id)).toContain("future");
  });

  it("drops an edge left dangling by a dropped object, because React Flow throws on one", () => {
    const broken: PublishedScape = {
      ...sample,
      objects: [
        ...sample.objects,
        { id: "bad", type: "note", title: "Broken", data: { body: 42 }, x: 0, y: 0 },
      ],
      relationships: [...sample.relationships, { id: "r-bad", from: "brief", to: "bad" }],
    };
    expect(prepare(broken).edges.map((edge) => edge.id)).not.toContain("r-bad");
  });

  it("marks every node non-interactive", () => {
    for (const node of prepare(sample).nodes) {
      expect(node.draggable).toBe(false);
      expect(node.connectable).toBe(false);
      expect(node.selectable).toBe(false);
    }
  });

  it("uses a high-contrast edge treatment for the public canvas", () => {
    const edge = prepare(sample).edges[0]!;
    expect(edge.style).toMatchObject({ stroke: "var(--text-secondary)", strokeWidth: 2 });
  });
});

describe("rendering the canvas", () => {
  it("draws the scape name and the objects' content", () => {
    const { container, unmount } = render(<PublicationCanvas scape={sample} embed={false} />);
    expect(container.textContent).toContain("Fintech onboarding");
    expect(container.textContent).toContain("Published scape");
    expect(container.textContent).toContain("Copy & edit");
    expect(container.textContent).toContain("Onboarding brief");
    // A note's Markdown body renders through the same component the editor uses.
    expect(container.textContent).toContain("New customers abandon at identity verification");
    // Read-only anchors are intentionally invisible, but React Flow needs them to calculate
    // every relationship's endpoints. Without them, it silently omits all public flow lines.
    expect(container.querySelectorAll(".react-flow__handle.source")).toHaveLength(sample.objects.length);
    expect(container.querySelectorAll(".react-flow__handle.target")).toHaveLength(sample.objects.length);
    unmount();
  });

  it("offers a way out of an embed and no way to edit one", () => {
    const { container, unmount } = render(<PublicationCanvas scape={sample} embed />);
    const link = container.querySelector<HTMLAnchorElement>('a[href*="precipice"]');
    expect(link?.textContent).toContain("Open in Precipice");
    expect(link?.rel).toContain("noopener");
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    unmount();
  });

  it("says so when an object could not be displayed", () => {
    const broken: PublishedScape = {
      ...sample,
      objects: [
        ...sample.objects,
        { id: "bad", type: "note", title: "Broken", data: { body: 42 }, x: 0, y: 0 },
      ],
    };
    const { container, unmount } = render(<PublicationCanvas scape={broken} embed={false} />);
    expect(container.textContent).toContain("1 block could not be displayed");
    unmount();
  });
});

describe("the pages that are not a scape", () => {
  const cases = [
    ["missing", <MissingState />, "Nothing here"],
    ["unpublished", <UnpublishedState />, "No longer published"],
    ["error", <ErrorState detail="Server returned 500." />, "Could not load this scape"],
    ["unknown route", <UnknownRouteState />, "Nothing here"],
  ] as const;

  for (const [name, element, heading] of cases) {
    it(`${name} says what happened`, () => {
      const { container, unmount } = render(element);
      expect(container.textContent).toContain(heading);
      unmount();
    });
  }

  it("distinguishes unpublished from never-existed in its copy", () => {
    const missing = render(<MissingState />);
    const unpublished = render(<UnpublishedState />);
    expect(missing.container.textContent).not.toEqual(unpublished.container.textContent);
    missing.unmount();
    unpublished.unmount();
  });
});
