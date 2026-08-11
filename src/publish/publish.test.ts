import { beforeEach, describe, expect, it } from "vitest";
import { fixtureScape } from "@/core/fixtures";
import type { Scape } from "@/core/types";
import {
  PublishClientError,
  createPublication,
  deletePublication,
  exchange,
  listPublications,
  logout,
  republish,
  unpublish,
  updatePublication,
} from "./client";
import { LIMITS, PUBLICATION_LIMIT, publishedScapeSchema } from "./contract";
import { projectScape, projectionHash } from "./project";
import { readAuthFragment, safeRoute } from "./session";
import { PublishStub } from "./stub";

const scape = () => fixtureScape();

describe("projecting a scape for publication", () => {
  it("produces something the wire contract accepts", () => {
    const { scape: projected, skipped } = projectScape(scape());
    expect(skipped).toEqual([]);
    expect(publishedScapeSchema.safeParse(projected).success).toBe(true);
  });

  it("strips every local-only field", () => {
    const source = scape();
    const { scape: projected } = projectScape(source);

    expect(projected).not.toHaveProperty("id");
    expect(projected).not.toHaveProperty("meta");
    expect(projected).not.toHaveProperty("createdAt");
    expect(projected).not.toHaveProperty("updatedAt");
    expect(projected).not.toHaveProperty("objectOrder");
    for (const object of projected.objects) {
      expect(object).not.toHaveProperty("createdAt");
      expect(object).not.toHaveProperty("updatedAt");
    }
  });

  it("keeps the author's order and positions", () => {
    const source = scape();
    const { scape: projected } = projectScape(source);
    expect(projected.objects.map((object) => object.id)).toEqual(source.objectOrder);
    expect(projected.objects[0].x).toBe(source.objects[source.objectOrder[0]].x);
  });

  it("skips an object whose type this build does not know", () => {
    const source = scape();
    source.objects.ghost = {
      id: "ghost",
      type: "hologram",
      title: "From the future",
      data: {},
      x: 0,
      y: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    source.objectOrder.push("ghost");

    const { scape: projected, skipped } = projectScape(source);
    expect(skipped).toEqual([{ id: "ghost", reason: "unknown type" }]);
    expect(projected.objects.map((object) => object.id)).not.toContain("ghost");
  });

  it("skips an object whose data fails its own schema", () => {
    const source = scape();
    source.objects.brief.data = { body: 42 };
    const { skipped } = projectScape(source);
    expect(skipped).toEqual([{ id: "brief", reason: "invalid data" }]);
  });

  it("skips an object whose data exceeds the per-object byte cap", () => {
    const source = scape();
    source.objects.brief.data = { body: "x".repeat(LIMITS.objectDataBytes + 100) };
    expect(projectScape(source).skipped).toEqual([{ id: "brief", reason: "over limit" }]);
  });

  it("drops a relationship left dangling by a skipped object", () => {
    const source = scape();
    source.objects.brief.data = { body: 42 };
    const { scape: projected } = projectScape(source);
    for (const rel of projected.relationships) {
      expect(rel.from).not.toBe("brief");
      expect(rel.to).not.toBe("brief");
    }
  });
});

describe("the projection hash", () => {
  it("changes when the document changes", async () => {
    const before = await projectionHash(projectScape(scape()).scape);
    const edited = scape();
    edited.objects.brief.title = "Something else";
    const after = await projectionHash(projectScape(edited).scape);
    expect(after).not.toBe(before);
  });

  it("does not change when only local-only fields change", async () => {
    const before = await projectionHash(projectScape(scape()).scape);
    const touched = scape();
    touched.updatedAt = Date.now();
    touched.objects.brief.updatedAt = Date.now();
    touched.meta = { starter: "mind-map" };
    expect(await projectionHash(projectScape(touched).scape)).toBe(before);
  });

  it("is stable across two runs over the same document", async () => {
    const a = await projectionHash(projectScape(scape()).scape);
    const b = await projectionHash(projectScape(scape()).scape);
    expect(a).toBe(b);
  });
});

describe("the publication lifecycle, against the stub", () => {
  let stub: PublishStub;
  let options: { token: string; fetchImpl: typeof fetch };

  beforeEach(() => {
    stub = new PublishStub();
    options = { token: stub.token!, fetchImpl: stub.fetch as unknown as typeof fetch };
  });

  const publish = (source: Scape = scape()) =>
    createPublication(projectScape(source).scape, options);

  it("publishes, and reports the hash the server computed", async () => {
    const published = await publish();
    expect(published.status).toBe("published");
    expect(published.version).toBe(1);
    expect(published.url).toContain(published.publicationId);
    expect(published.hash).toBe(await projectionHash(projectScape(scape()).scape));
  });

  it("updates in place without consuming a second slot", async () => {
    const first = await publish();
    const edited = scape();
    edited.objects.brief.title = "Revised brief";

    const updated = await updatePublication(
      first.publicationId,
      projectScape(edited).scape,
      options,
    );

    expect(updated.publicationId).toBe(first.publicationId);
    expect(updated.version).toBe(2);
    expect(updated.hash).not.toBe(first.hash);
    expect((await listPublications(options)).used).toBe(1);
  });

  it("refuses a fifty-first retained publication and says why", async () => {
    for (let i = 0; i < PUBLICATION_LIMIT; i++) {
      const source = scape();
      source.name = `Scape ${i}`;
      await publish(source);
    }
    expect((await listPublications(options)).used).toBe(PUBLICATION_LIMIT);

    const error = await publish(scape()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PublishClientError);
    expect((error as PublishClientError).code).toBe("quota_exceeded");
    expect((error as PublishClientError).message).toContain("Delete one");
  });

  it("retains a slot on unpublish and keeps the id for republish", async () => {
    const published = await publish();
    const withdrawn = await unpublish(published.publicationId, options);

    expect(withdrawn.status).toBe("unpublished");
    expect((await listPublications(options)).used).toBe(1);

    const restored = await republish(published.publicationId, options);
    expect(restored.status).toBe("published");
    // The URL surviving an unpublish is the whole reason the id does.
    expect(restored.publicationId).toBe(published.publicationId);
  });

  it("removes public access on delete", async () => {
    const published = await publish();
    await deletePublication(published.publicationId, options);

    expect((await listPublications(options)).publications).toHaveLength(0);
    const error = await unpublish(published.publicationId, options).catch((e: unknown) => e);
    expect((error as PublishClientError).code).toBe("not_found");
  });

  it("rejects a call with no session", async () => {
    const error = await createPublication(projectScape(scape()).scape, {
      fetchImpl: stub.fetch as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect((error as PublishClientError).code).toBe("unauthorized");
  });

  it("revokes the current publishing session on sign-out", async () => {
    await logout(options);
    const error = await listPublications(options).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PublishClientError);
    expect((error as PublishClientError).code).toBe("unauthorized");
  });

  it("mints a session from a one-time code", async () => {
    const signedOut = new PublishStub({ token: null });
    const session = await exchange("code-000000000000000000", {
      fetchImpl: signedOut.fetch as unknown as typeof fetch,
    });
    expect(session.token.length).toBeGreaterThanOrEqual(20);
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe("the OAuth return fragment", () => {
  it("carries the token and the route in one fragment, because routes live in the hash", () => {
    const parsed = readAuthFragment("#token=abcdefghijklmnopqrstuvwx&return=%2Fs%2Fscp_abc123");
    expect(parsed).toEqual({ code: "abcdefghijklmnopqrstuvwx", returnRoute: "/s/scp_abc123" });
  });

  it("ignores a fragment that is an ordinary route", () => {
    expect(readAuthFragment("#/s/scp_abc123")).toBeNull();
    expect(readAuthFragment("")).toBeNull();
  });

  it("rejects a malformed code rather than sending it", () => {
    expect(readAuthFragment("#token=short")).toBeNull();
    expect(readAuthFragment("#token=has%20a%20space%20in%20it%20and%20is%20long")).toBeNull();
  });

  it("falls back to the root for every hostile return value", () => {
    for (const hostile of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "http:/evil.example",
      "javascript:alert(1)",
      "/path\r\nX-Injected: 1",
      "/path?x=1#@evil.example",
      "/@evil.example",
      `/${"x".repeat(300)}`,
      "",
    ]) {
      expect(safeRoute(hostile), hostile).toBe("/");
    }
  });

  it("passes through the routes the app actually uses", () => {
    expect(safeRoute("/s/scp_abc123")).toBe("/s/scp_abc123");
    expect(safeRoute("/")).toBe("/");
    // `slugId` produces hyphens, so they must survive.
    expect(safeRoute("/s/happy-path_2")).toBe("/s/happy-path_2");
  });
});
