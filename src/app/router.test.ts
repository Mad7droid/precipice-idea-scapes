import { describe, expect, it } from "vitest";
import { match, scapeRoute } from "./router";

/**
 * The router grew exactly one feature — a single trailing parameter — rather than a
 * dependency. These are the edges that made it worth writing down instead of inlining.
 */
describe("route matching", () => {
  it("reads the id out of a scape route", () => {
    expect(match("/s", "/s/scp_abc")).toBe("scp_abc");
  });

  it("does not match the bare prefix, or a different one", () => {
    expect(match("/s", "/s")).toBeNull();
    expect(match("/s", "/s/")).toBeNull();
    expect(match("/s", "/")).toBeNull();
    expect(match("/s", "/settings/scp_abc")).toBeNull();
  });

  it("refuses a nested path rather than silently loading the wrong scape", () => {
    expect(match("/s", "/s/scp_abc/settings")).toBeNull();
  });

  it("round-trips an id that needs encoding", () => {
    const id = "scp a/b?c";
    expect(match("/s", scapeRoute(id))).toBe(id);
  });
});
