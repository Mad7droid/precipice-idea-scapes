import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import config from "../../tailwind.config";
import { describe, expect, it } from "vitest";
import { interfaceStyle, applyInterfaceStyle, readInterfaceStyle } from "./interfaceStyle";

const css = readFileSync(resolve(__dirname, "interface-styles.css"), "utf8");
const rgb = (hex: string) =>
  hex
    .slice(1)
    .match(/../g)!
    .slice(0, 3)
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

it("keeps typed, placeholder and selected text readable in all six palette/mode combinations", () => {
  const base = postcss.parse(readFileSync(resolve(__dirname, "tokens.css"), "utf8"));
  const alternative = postcss.parse(css);
  for (const style of ["current", "graphite", "field"]) {
    for (const dark of [false, true]) {
      const tokens: Record<string, string> = {};
      base.walkRules((rule) => {
        if (
          rule.selector === ":root" ||
          rule.selector === ":root,\n:root.light" ||
          (dark && rule.selector === ":root.dark")
        )
          rule.walkDecls((decl) => {
            if (decl.prop.startsWith("--")) tokens[decl.prop] = decl.value;
          });
      });
      alternative.walkRules((rule) => {
        if (
          rule.selector === `:root[data-interface-style="${style}"]` ||
          (dark && rule.selector === `:root.dark[data-interface-style="${style}"]`)
        )
          rule.walkDecls((decl) => {
            if (decl.prop.startsWith("--")) tokens[decl.prop] = decl.value;
          });
      });
      const value = (key: string): string => {
        const raw = tokens[key];
        return raw?.startsWith("var(") ? value(raw.slice(4, -1)) : raw;
      };
      for (const foreground of ["--text-primary", "--text-tertiary"])
        expect(
          contrast(value(foreground), value("--bg-inset")),
          `${style}/${dark}: ${foreground}`,
        ).toBeGreaterThanOrEqual(4.5);
      let selection = value("--bg-selected");
      if (selection.startsWith("rgba(")) {
        const [r, g, b, alpha] = selection.match(/[\d.]+/g)!.map(Number);
        const background = value("--bg-inset")
          .slice(1)
          .match(/../g)!
          .map((v) => parseInt(v, 16));
        selection =
          "#" +
          [r, g, b]
            .map((channel, i) =>
              Math.round(channel * alpha + background[i] * (1 - alpha))
                .toString(16)
                .padStart(2, "0"),
            )
            .join("");
      }
      expect(
        contrast(value("--text-primary"), selection),
        `${style}/${dark}: selected`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});

describe("interface palette contract", () => {
  it("keeps the text-base size utility independent of the base background colour", async () => {
    const output = await postcss([
      tailwindcss({
        ...config,
        content: [
          { raw: '<div class="text-base bg-base text-fg-secondary"></div>', extension: "html" },
        ],
      }),
    ]).process("@tailwind utilities;", { from: undefined });
    const root = postcss.parse(output.css);
    const text: string[] = [];
    root.walkRules(".text-base", (rule) => {
      rule.walkDecls((declaration) => {
        text.push(declaration.prop);
      });
    });
    expect(text).toContain("font-size");
    expect(text).not.toContain("color");
    expect(output.css).toContain("background-color: var(--bg-base)");
  });
  it("defaults invalid choices to Current and changes only the root style attribute", () => {
    localStorage.setItem("precipice.interfaceStyle", "unknown");
    expect(readInterfaceStyle()).toBe("current");
    expect(interfaceStyle({ value: "field" })).toBe("current");
    document.documentElement.classList.add("dark");
    applyInterfaceStyle("field");
    expect(document.documentElement.dataset.interfaceStyle).toBe("field");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    delete document.documentElement.dataset.interfaceStyle;
  });
  it("keeps every alternative text role readable on all working surfaces", () => {
    const blocks = [...css.matchAll(/(:root[^{}]+)\{([^}]+)\}/g)];
    expect(blocks).toHaveLength(4);
    for (const [, selector, body] of blocks) {
      const tokens = Object.fromEntries(
        [...body.matchAll(/(--[\w-]+):\s*(#[\da-f]{6,8})\s*;/g)].map((m) => [m[1], m[2]]),
      );
      for (const fg of ["--text-primary", "--text-secondary", "--text-tertiary", "--text-accent"])
        for (const bg of [
          "--bg-base",
          "--bg-surface",
          "--bg-raised",
          "--bg-inset",
          "--bg-canvas",
          "--bg-selected",
        ])
          expect(
            contrast(tokens[fg], tokens[bg]),
            `${selector}: ${fg} on ${bg}`,
          ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(tokens["--text-on-action-primary"], tokens["--action-primary"]),
      ).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens["--border-focus"], tokens["--bg-raised"])).toBeGreaterThanOrEqual(3);
    }
  });
  it("does not override identity, type, status, marker, geometry or motion tokens", () => {
    expect(css).not.toMatch(
      /--(?:font|brand|obj|mark|success|danger|warning|info|r-|dur|ease)[\w-]*\s*:/,
    );
    expect(css).not.toMatch(/filter\s*:|animation\s*:|transition\s*:/);
  });
});
