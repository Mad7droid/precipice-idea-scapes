import { act } from "react";
import { describe, expect, it } from "vitest";
import { fixtureScape } from "@/core/fixtures";
import type { PublicationRecord, PublicationStore, Scape } from "@/core/types";
import { render } from "@/test/react";
import { projectScape, projectionHash } from "./project";
import { usePublication, type PublicationView } from "./usePublication";

function store(row?: PublicationRecord): PublicationStore {
  return {
    get: async () => row,
    all: async () => (row ? [row] : []),
    put: async () => {},
    remove: async () => {},
  };
}

async function viewOf(scape: Scape, row?: PublicationRecord): Promise<PublicationView> {
  let view!: PublicationView;
  // Stable, as the real repository is: the hook refreshes whenever its identity changes.
  const repository = { publications: store(row) };
  function Probe() {
    view = usePublication(scape, repository);
    return null;
  }
  const mounted = render(<Probe />);
  // The row read and the hash are both async; let them settle.
  for (let i = 0; i < 5; i++) await act(async () => {});
  mounted.unmount();
  return view;
}

describe("usePublication", () => {
  const scape = fixtureScape();
  const record = (publishedHash: string): PublicationRecord => ({
    scapeId: scape.id,
    publicationId: "pub_1",
    publishedHash,
    version: 1,
    status: "published",
    updatedAt: 1,
  });

  it("reports a published scape whose content matches as published", async () => {
    const hash = await projectionHash(projectScape(scape).scape);
    const view = await viewOf(scape, record(hash));
    expect(view.state.kind).toBe("published");
    expect(view.localHash).toBe(hash);
  });

  it("reports an edited published scape as stale", async () => {
    const view = await viewOf(scape, record("0".repeat(64)));
    expect(view.state.kind).toBe("stale");
  });

  it("does not project or hash a scape that is not published", async () => {
    const view = await viewOf(scape);
    expect(view.state.kind).toBe("unpublished");
    expect(view.localHash).toBeNull();
  });
});
