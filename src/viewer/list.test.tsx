import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { publishedScapeSchema } from "@/publish/contract";
import { render } from "@/test/react";
import { PublicationCanvas } from "./PublicationCanvas";
import { readingOrder } from "./PublicationList";

const sample = publishedScapeSchema.parse(
  JSON.parse(readFileSync(resolve(__dirname, "fixtures/sample-publication.json"), "utf8")),
);

const width = window.innerWidth;
afterEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
});

describe("readingOrder", () => {
  it("reads a wide layout column by column, tolerating ragged columns", () => {
    const at = (id: string, x: number, y: number) => ({ id, x, y });
    const order = readingOrder([
      at("c", 400, 0),
      at("b", 10, 200),
      at("a", 0, 0),
      at("d", 410, 150),
      at("e", 800, 0),
    ]);
    expect(order.map((o) => o.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("reads a tall layout row by row", () => {
    const at = (id: string, x: number, y: number) => ({ id, x, y });
    const order = readingOrder([at("c", 0, 600), at("b", 200, 5), at("a", 0, 0)]);
    expect(order.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });
});

describe("published scape on a phone", () => {
  it("opens as a list with every block and jump links for its connections", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    const { container, unmount } = render(<PublicationCanvas scape={sample} embed={false} />);
    expect(container.querySelectorAll("article")).toHaveLength(sample.objects.length);
    const link = container.querySelector<HTMLAnchorElement>("nav[aria-label='Connected to'] a")!;
    expect(container.querySelector(link.getAttribute("href")!)).not.toBeNull();

    const canvas = [
      ...container.querySelectorAll("[aria-label='View as'] button"),
    ][0] as HTMLElement;
    act(() => canvas.click());
    expect(container.querySelector("article")).toBeNull();
    unmount();
  });

  it("keeps the embed a canvas at any width", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    const { container, unmount } = render(<PublicationCanvas scape={sample} embed />);
    expect(container.querySelector("article")).toBeNull();
    expect(container.querySelector("[aria-label='View as']")).toBeNull();
    unmount();
  });

  it("opens as a canvas on a wide screen", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    const { container, unmount } = render(<PublicationCanvas scape={sample} embed={false} />);
    expect(container.querySelector("article")).toBeNull();
    unmount();
  });
});
