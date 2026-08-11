import { describe, expect, it } from "vitest";
import { allPlugins, getPlugin, pluginTypes } from "./registry";

describe("object registry", () => {
  it("self-registers every plugin under src/objects, with no barrel file", () => {
    expect(pluginTypes()).toEqual(["journey", "note", "wireframe"]);
  });

  it("returns undefined for an unregistered type rather than throwing", () => {
    expect(getPlugin("nope")).toBeUndefined();
  });

  it("sorts stably, so menus do not reorder between builds", () => {
    const types = allPlugins().map((plugin) => plugin.type);
    expect(types).toEqual([...types].sort());
  });
});
