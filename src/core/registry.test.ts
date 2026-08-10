import { describe, expect, it } from "vitest";
import { allPlugins, allViewPlugins, getPlugin, getViewPlugin, pluginTypes } from "./registry";

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

describe("view registry", () => {
  /**
   * Wave 0 ships the glob; the `view.ts` files themselves are workstream B's. Until they land
   * this registry is legitimately empty, and these assertions are about the mechanism rather
   * than its contents.
   */
  it("returns undefined for an unregistered type", () => {
    expect(getViewPlugin("nope")).toBeUndefined();
  });

  it("is a separate registry from the editor's, not a projection of it", () => {
    // Every editor type registering a view is B's checklist item, not a fact about wave 0.
    // What must be true now is that the two globs do not feed each other.
    expect(allViewPlugins().map((plugin) => plugin.type)).not.toContain("note-editor-leak");
    for (const plugin of allViewPlugins()) {
      expect(plugin).not.toHaveProperty("Inspector");
      expect(plugin).not.toHaveProperty("defaults");
    }
  });
});
