import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer, toolResult } from "./server";
import { FLOW_UI_HTML, FLOW_UI_MIME, FLOW_UI_URI } from "./flowUi";

const preview = {
  structuredContent: {
    status: "preview",
    operation_id: "op_draft",
    scape_id: "scp_new",
    message: "Added 3 objects.",
  },
  _meta: {
    can_write: true,
    confirmation_token: "secret_ui_only",
    expires_at: Date.now() + 600_000,
    preview: {
      name: "Signup <script>alert(1)</script>",
      target: "new",
      objects: [
        {
          id: "note",
          type: "note",
          title: "Brief",
          x: 0,
          y: 0,
          data: { body: '<img src=x onerror="alert(1)">Fictional signup brief' },
        },
        {
          id: "journey",
          type: "journey",
          title: "Signup journey",
          x: 400,
          y: 0,
          data: { steps: [{ id: "step", label: "Create account", detail: "Choose your details" }] },
        },
        {
          id: "screen",
          type: "wireframe",
          title: "Signup screen",
          x: 800,
          y: 0,
          data: {
            columns: 4,
            primitives: [
              { id: "heading", kind: "heading", span: 4, label: "Welcome" },
              { id: "input", kind: "input", span: 4, label: "Email address" },
            ],
          },
        },
      ],
      relationships: [{ id: "r1", from: "note", to: "journey", label: "supports" }],
    },
  },
};

const windows: JSDOM[] = [];
afterEach(() => {
  for (const dom of windows.splice(0)) dom.window.close();
});

async function host(result = preview) {
  const dom = new JSDOM(FLOW_UI_HTML, {
    runScripts: "outside-only",
    url: "https://sandbox.example.test/",
  });
  windows.push(dom);
  const win = dom.window;
  const calls: any[] = [];
  const parent = {
    postMessage: (message: any) => {
      calls.push(message);
    },
  };
  Object.defineProperty(win, "parent", { value: parent });
  const deliver = (data: unknown, source: any = parent) =>
    win.dispatchEvent(new win.MessageEvent("message", { data, source }));
  win.eval(win.document.querySelector("script")!.textContent!);
  const init = calls.find((c) => c.method === "ui/initialize");
  deliver({
    jsonrpc: "2.0",
    id: init.id,
    result: { hostCapabilities: { serverTools: {} }, hostContext: { theme: "dark" } },
  });
  await Promise.resolve();
  deliver({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: structuredClone(result),
  });
  return {
    win,
    calls,
    deliver,
    button: (id: string) => win.document.getElementById(id) as HTMLButtonElement,
  };
}

describe("MCP Apps server", () => {
  it("registers the portable resource, app-only mutations, and keeps UI content out of model context", async () => {
    const server = buildMcpServer(async () => ({
      ...preview.structuredContent,
      _meta: preview._meta,
    }));
    const client = new Client({ name: "fixture-client", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const { tools } = await client.listTools();
      expect(tools.find((t) => t.name === "preview_flow")?._meta?.ui).toEqual({
        resourceUri: FLOW_UI_URI,
      });
      for (const name of ["confirm_flow", "share_flow_preview"])
        expect(tools.find((t) => t.name === name)?._meta?.ui).toEqual({ visibility: ["app"] });
      const resource = await client.readResource({ uri: FLOW_UI_URI });
      expect(resource.contents[0]).toMatchObject({ mimeType: FLOW_UI_MIME, text: FLOW_UI_HTML });
      const result = await client.callTool({
        name: "preview_flow",
        arguments: {
          actions: [
            {
              type: "CreateObject",
              id: "n",
              objectType: "note",
              title: "N",
              data: { body: "hello" },
            },
          ],
        },
      });
      const text = JSON.stringify({
        content: result.content,
        structuredContent: result.structuredContent,
      });
      expect(text).not.toContain("secret_ui_only");
      expect(text).not.toContain("Fictional signup brief");
      expect(result._meta).toEqual({ ui: { resourceUri: FLOW_UI_URI }, ...preview._meta });
      expect(toolResult({ status: "failed", error: "forbidden" }).isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("flow preview UI", () => {
  it("handshakes with the standard bridge, themes to the host, and renders untrusted text safely", async () => {
    const { win, calls, button } = await host();
    expect(calls).toContainEqual({
      jsonrpc: "2.0",
      method: "ui/notifications/initialized",
      params: {},
    });
    expect(win.document.documentElement.className).toBe("dark");
    expect(win.document.getElementById("name")?.textContent).toBe(preview._meta.preview.name);
    expect(win.document.querySelector("article img")).toBeNull();
    expect(win.document.querySelector("article")?.textContent).toContain("<img src=x");
    expect(button("create").disabled).toBe(false);
    expect(win.document.querySelectorAll(".node")).toHaveLength(3);
  });

  it("inspects journeys and wireframes locally without any tool or model calls", async () => {
    const { win, calls, button } = await host();
    const count = calls.length;
    button("next").click();
    expect(win.document.querySelector("article ol")?.textContent).toContain("Create account");
    button("next").click();
    expect(win.document.querySelector(".wireframe")?.textContent).toContain("Email address");
    expect(calls).toHaveLength(count);
  });

  it("sends only the preview capability on click, prevents duplicate clicks and shows the creation receipt", async () => {
    const { win, calls, button, deliver } = await host();
    button("create").click();
    button("create").click();
    const writes = calls.filter((c) => c.method === "tools/call");
    expect(writes).toHaveLength(1);
    expect(writes[0].params).toEqual({
      name: "confirm_flow",
      arguments: {
        scape_id: "scp_new",
        preview_id: "op_draft",
        confirmation_token: "secret_ui_only",
        approve: true,
      },
    });
    deliver({
      jsonrpc: "2.0",
      id: writes[0].id,
      result: { structuredContent: { status: "applied", message: "Added 3 objects." } },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(win.document.getElementById("badge")?.textContent).toBe("Created in Precipice");
    expect(button("create").disabled).toBe(true);
  });

  it("requires an explicit public-disclosure click before sharing and exposes iframe code", async () => {
    const { win, calls, button, deliver } = await host();
    button("share").click();
    expect(calls.filter((c) => c.method === "tools/call")).toHaveLength(0);
    expect(win.document.getElementById("sharing")?.hidden).toBe(false);
    button("publish").click();
    const share = calls.find((c) => c.method === "tools/call");
    expect(share.params.name).toBe("share_flow_preview");
    deliver({
      jsonrpc: "2.0",
      id: share.id,
      result: {
        structuredContent: {
          status: "ok",
          url: "https://example.test/p/pub_test",
          iframe: '<iframe src="https://example.test/embed/pub_test"></iframe>',
          message: "Shared",
        },
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect((win.document.getElementById("embed") as HTMLTextAreaElement).value).toContain(
      "/embed/pub_test",
    );
    expect(win.document.getElementById("links")?.hidden).toBe(false);
  });

  it("ignores messages from other frames and disables expired or read-only previews", async () => {
    const { button, deliver } = await host({
      ...preview,
      _meta: { ...preview._meta, can_write: false },
    });
    expect(button("create").disabled).toBe(true);
    deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: preview }, {});
    expect(button("create").disabled).toBe(true);
    const expired = await host({
      ...preview,
      _meta: { ...preview._meta, expires_at: Date.now() - 1000 },
    });
    expect(expired.button("create").disabled).toBe(true);
    expect(expired.win.document.getElementById("badge")?.textContent).toBe("Preview expired");
  });

  it("recovers the share and withdrawal control after reloading an expired preview", async () => {
    const { win, calls, button, deliver } = await host({
      ...preview,
      _meta: { ...preview._meta, expires_at: Date.now() - 1000 },
    });
    button("refresh").click();
    const request = calls.find((c) => c.method === "tools/call");
    expect(request.params.name).toBe("get_operation");
    deliver({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        structuredContent: { status: "preview" },
        _meta: { share: { url: "https://example.test/p/pub_test", iframe: "<iframe></iframe>" } },
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(win.document.getElementById("sharing")?.hidden).toBe(false);
    expect(button("withdraw").disabled).toBe(false);
    expect(button("create").disabled).toBe(true);
  });

  it("disables mutations after host cancellation", async () => {
    const { button, deliver } = await host();
    deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-cancelled", params: {} });
    expect(button("create").disabled).toBe(true);
    expect(button("share").disabled).toBe(true);
    expect(button("discard").disabled).toBe(true);
  });

  it("clears a withdrawn share when refreshing a preview open in another widget", async () => {
    const { win, calls, button, deliver } = await host();
    button("refresh").click();
    let request = calls.filter((c) => c.method === "tools/call").at(-1);
    deliver({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        structuredContent: { status: "preview" },
        _meta: { share: { url: "https://example.test/p/pub_test", iframe: "<iframe></iframe>" } },
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(button("withdraw").disabled).toBe(false);
    button("refresh").click();
    request = calls.filter((c) => c.method === "tools/call").at(-1);
    deliver({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        structuredContent: { status: "preview" },
        _meta: { share: null },
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(win.document.getElementById("links")?.hidden).toBe(true);
    expect(button("withdraw").disabled).toBe(true);
    expect((win.document.getElementById("embed") as HTMLTextAreaElement).value).toBe("");
  });

  it("ships no remote code, AI client or credentials, and matches the project motion token", () => {
    expect(FLOW_UI_HTML).not.toMatch(
      /<script[^>]+src=|<link[^>]+href=|\bfetch\(|localStorage|sessionStorage|apiKey|anthropic/,
    );
    const tokens = readFileSync("src/design/tokens.css", "utf8");
    expect(tokens).toContain("--dur-fast: 130ms");
    expect(FLOW_UI_HTML).toContain("--dur-fast:130ms");
    expect(FLOW_UI_HTML).toContain("prefers-reduced-motion:reduce");
  });
});
