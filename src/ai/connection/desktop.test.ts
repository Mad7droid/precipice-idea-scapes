import { beforeEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { desktopChatGPTFetch, nativeStream } from "./desktop";
import { runConnectedModel } from "./runtime";
import { generate, type GenerationEvent } from "@/ai/generate";
import { ask } from "@/ai/scapi/ask";
import type { AskEvent } from "@/ai/scapi/types";
import { emptyScape, fixtureScape } from "@/core/fixtures";
import { useScapeStore } from "@/core/store";
import { CONNECT_TOOL_NAMES } from "@/ai/tools";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  Channel: class {
    onmessage = (_bytes: number[]) => {};
  },
}));
vi.mock("@/desktop/runtime", () => ({ isDesktop: () => true }));
const encoder = new TextEncoder();
const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const completed = (output: unknown[] = []) => ({
  type: "response.completed",
  response: { status: "completed", output },
});
const options = {
  modelId: "chatgpt/test",
  instructions: "Only the offered tools",
  input: [],
  tools: {},
  maxSteps: 3,
};

describe("native subscription transport", () => {
  beforeEach(() => {
    invoke.mockReset();
  });
  function chatgpt(...streams: string[]) {
    invoke.mockImplementation(async (command, args) => {
      if (command === "chatgpt_status") return { status: "connected", connectionId: "account" };
      if (command === "chatgpt_request") {
        for (const byte of encoder.encode(streams.shift() ?? event(completed())))
          args.onChunk.onmessage([byte]);
      }
    });
  }
  it("streams UTF-8 over native channels without browser credentials or HTTP", async () => {
    chatgpt(event({ type: "response.output_text.delta", delta: "नमस्ते 👋" }) + event(completed()));
    expect(await runConnectedModel(options)).toBe("नमस्ते 👋");
    const args = invoke.mock.calls.find(([name]) => name === "chatgpt_request")![1];
    expect(args.body).toMatchObject({ connectionId: "account", model: "test" });
    expect(JSON.stringify(args)).not.toMatch(/access_token|authorization|apiKey/);
  });
  it("validates and executes an offered operation exactly once, then returns its result", async () => {
    const execute = vi.fn(async ({ text }) => ({ created: text }));
    chatgpt(
      event(
        completed([
          {
            type: "function_call",
            namespace: "precipice",
            name: "note",
            call_id: "one",
            arguments: '{"text":"hello"}',
          },
        ]),
      ),
      event(completed()),
    );
    await runConnectedModel({
      ...options,
      tools: { note: tool({ inputSchema: z.object({ text: z.string() }), execute }) },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    const requests = invoke.mock.calls.filter(([name]) => name === "chatgpt_request");
    expect(requests[1][1].body.input).toContainEqual({
      type: "function_call_output",
      call_id: "one",
      output: '{"created":"hello"}',
    });
  });
  it("rejects unknown and unfinished operations without applying changes", async () => {
    const execute = vi.fn();
    const tools = { read: tool({ inputSchema: z.object({}), execute }) };
    chatgpt(
      event(
        completed([
          {
            type: "function_call",
            namespace: "precipice",
            name: "delete",
            call_id: "one",
            arguments: "{}",
          },
        ]),
      ),
    );
    await expect(runConnectedModel({ ...options, tools })).rejects.toThrow("unavailable");
    chatgpt(
      event({ type: "response.output_item.done", item: { type: "function_call", name: "read" } }),
    );
    await expect(runConnectedModel({ ...options, tools })).rejects.toThrow("before completion");
    expect(execute).not.toHaveBeenCalled();
  });
  it("surfaces native authentication and quota failures without success events", async () => {
    invoke.mockImplementation((command) => {
      if (command === "chatgpt_status")
        return Promise.resolve({ status: "connected", connectionId: "account" });
      return Promise.reject(
        new Error("ChatGPT usage limit reached. Manage usage in Settings → AI."),
      );
    });
    const failure = await runConnectedModel(options).then(
      () => null,
      (error: unknown) => error,
    );
    expect(String(failure)).toContain("usage limit reached");
  });
  it("cancels a pending native stream immediately and ignores late bytes", async () => {
    const controller = new AbortController();
    let nativeArgs: { id: string; onChunk: { onmessage: (bytes: number[]) => void } } | undefined;
    invoke.mockImplementation((command, args) => {
      if (command === "chatgpt_request") {
        nativeArgs = args;
        return new Promise(() => {});
      }
      return Promise.resolve();
    });
    const reader = nativeStream("chatgpt_request", { body: {} }, controller.signal).getReader();
    const read = reader.read();
    controller.abort();
    await expect(read).rejects.toMatchObject({ name: "AbortError" });
    expect(invoke).toHaveBeenCalledWith("ai_cancel", { id: nativeArgs!.id });
    expect(() => nativeArgs!.onChunk.onmessage([1, 2])).not.toThrow();
  });
  it("does not start an already-cancelled request and rejects arbitrary routes", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new Response(nativeStream("chatgpt_request", {}, controller.signal)).text(),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(invoke).not.toHaveBeenCalled();
    await expect(desktopChatGPTFetch("https://untrusted.example")).rejects.toThrow("Unsupported");
  });
});

describe("Claude plan via native Claude Code", () => {
  beforeEach(() => {
    invoke.mockReset();
  });
  function claude(...answers: unknown[]) {
    invoke.mockImplementation(async (command) => {
      if (command === "claude_status")
        return { connected: true, email: "person@example.test", connectionId: "workspace-a" };
      if (command === "claude_request") return answers.shift() ?? { text: "Done", calls: [] };
    });
  }
  it("uses the Claude model and same validated tool loop with portable context", async () => {
    claude(
      { text: "", calls: [{ name: "read", arguments: '{"id":"a"}' }] },
      { text: "The note says hello", calls: [] },
    );
    const execute = vi.fn(async () => ({ text: "hello" }));
    const text = await runConnectedModel({
      ...options,
      modelId: "claude-plan/sonnet",
      webSearch: true,
      tools: { read: tool({ inputSchema: z.object({ id: z.string() }), execute }) },
    });
    expect(text).toBe("The note says hello");
    expect(execute).toHaveBeenCalledTimes(1);
    const args = invoke.mock.calls.find(([name]) => name === "claude_request")![1];
    expect(args.model).toBe("sonnet");
    expect(args.connectionId).toBe("workspace-a");
    expect(
      JSON.parse(args.prompt).tools.some((t: { type: string }) => t.type === "web_search"),
    ).toBe(false);
    expect(invoke.mock.calls.some(([name]) => name === "chatgpt_request")).toBe(false);
  });
  it("rejects malformed structured output before any operation", async () => {
    claude({ text: "partial", calls: "wrong" });
    await expect(runConnectedModel({ ...options, modelId: "claude-plan/sonnet" })).rejects.toThrow(
      "invalid response",
    );
  });
  it("does not offer write tools to a read-only ask", async () => {
    claude({ text: "", calls: [{ name: "CreateObject", arguments: "{}" }] });
    const read = vi.fn();
    await expect(
      runConnectedModel({
        ...options,
        modelId: "claude-plan/sonnet",
        tools: { read: tool({ inputSchema: z.object({}), execute: read }) },
      }),
    ).rejects.toThrow("unavailable");
    expect(read).not.toHaveBeenCalled();
  });
  it("never switches to API billing after a Claude plan failure", async () => {
    invoke.mockImplementation((command) => {
      if (command === "claude_status")
        return Promise.resolve({ connected: true, email: "person@example.test" });
      return Promise.reject(new Error("Claude plan usage limit reached."));
    });
    const failure = await runConnectedModel({ ...options, modelId: "claude-plan/sonnet" }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(String(failure)).toContain("Claude plan usage limit reached.");
    expect(
      invoke.mock.calls.every(([command]) => ["claude_status", "claude_request"].includes(command)),
    ).toBe(true);
    // Requests use the native cached account check instead of spawning `claude auth status`.
    expect(invoke.mock.calls.find(([command]) => command === "claude_status")?.[1]).toEqual({
      cached: true,
    });
  });
});

describe.each(["chatgpt/test", "claude-plan/sonnet"])("Scapi integration through %s", (modelId) => {
  beforeEach(() => {
    invoke.mockReset();
  });
  function responses(...answers: { text: string; calls: { name: string; arguments: string }[] }[]) {
    invoke.mockImplementation(async (command, args) => {
      if (command === "claude_status") return { connected: true, email: "person@example.test" };
      if (command === "chatgpt_status") return { status: "connected", connectionId: "account" };
      const answer = answers.shift() ?? { text: "Done", calls: [] };
      if (command === "claude_request") return answer;
      if (command === "chatgpt_request") {
        const calls = answer.calls.map((call) => ({
          ...call,
          type: "function_call",
          namespace: "precipice",
          call_id: crypto.randomUUID(),
        }));
        args.onChunk.onmessage(
          Array.from(
            encoder.encode(
              event({ type: "response.output_text.delta", delta: answer.text }) +
                event(completed(calls)),
            ),
          ),
        );
      }
    });
  }
  it("creates and connects objects through the real reducer, then undoes in one step", async () => {
    responses({
      text: "",
      calls: [
        {
          name: "CreateObject",
          arguments: JSON.stringify({
            id: "hello",
            objectType: "note",
            title: "Hello world",
            data: { body: "hello world" },
          }),
        },
        {
          name: "CreateObject",
          arguments: JSON.stringify({
            id: "journey",
            objectType: "journey",
            title: "Onboarding",
            data: { steps: [{ id: "one", label: "User opens the app" }] },
          }),
        },
        {
          name: "ConnectObjects",
          arguments: JSON.stringify({ id: "edge", from: "hello", to: "journey" }),
        },
      ],
    });
    const scape = emptyScape("scp_native_subscription");
    useScapeStore.getState().loadScape(scape);
    const events: GenerationEvent[] = [];
    const result = await generate({
      request: "Add a hello world note and connect it to an onboarding journey",
      scape,
      apiKey: "",
      modelId,
      spoken: { recent: ["We are mapping onboarding"] },
      dispatch: (action) => useScapeStore.getState().dispatch(action),
      onEvent: (event) => events.push(event),
    });
    expect(result.applied).toBe(3);
    expect(events.some((event) => event.kind === "error")).toBe(false);
    expect(useScapeStore.getState().scape!.relationships.edge).toMatchObject({
      from: "hello",
      to: "journey",
    });
    expect(useScapeStore.getState().undoStack).toHaveLength(1);
    useScapeStore.getState().undo();
    expect(useScapeStore.getState().scape!.objectOrder).toEqual([]);
    const args = invoke.mock.calls.find(([name]) => name.endsWith("_request"))![1];
    const instructions = args.body?.instructions ?? JSON.parse(args.prompt).instructions;
    expect(instructions).toContain("This request was spoken");
  });
  it("answers with the real read tools while leaving the canvas unchanged", async () => {
    responses(
      { text: "", calls: [{ name: "read_objects", arguments: '{"ids":["brief"]}' }] },
      { text: "The brief concerns onboarding.", calls: [] },
    );
    const scape = fixtureScape();
    const before = JSON.stringify(scape);
    const events: AskEvent[] = [];
    await ask({
      question: "What does the brief say?",
      scape,
      history: [],
      apiKey: "",
      modelId,
      onEvent: (event) => events.push(event),
    });
    expect(events).toContainEqual({ kind: "text", text: "The brief concerns onboarding." });
    expect(events.some((event) => event.kind === "done")).toBe(true);
    expect(JSON.stringify(scape)).toBe(before);
  });
  it("enforces selection scope and Connect tool restrictions in the real applier", async () => {
    const scape = fixtureScape();
    const dispatch = vi.fn(() => true);
    responses({
      text: "",
      calls: [
        { name: "UpdateObject", arguments: '{"id":"constraints","patch":{"title":"Forbidden"}}' },
      ],
    });
    const result = await generate({
      request: "Edit the selected brief",
      scape,
      apiKey: "",
      modelId,
      allowedObjectIds: ["brief"],
      dispatch,
      onEvent: () => {},
    });
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(1);
    expect(dispatch).not.toHaveBeenCalled();
    responses({
      text: "",
      calls: [
        {
          name: "CreateObject",
          arguments: '{"id":"bad","objectType":"note","title":"Bad","data":{"body":""}}',
        },
      ],
    });
    const events: GenerationEvent[] = [];
    await generate({
      request: "Connect the existing objects",
      scape,
      apiKey: "",
      modelId,
      mode: "connect",
      allowedTools: CONNECT_TOOL_NAMES,
      dispatch,
      onEvent: (event) => events.push(event),
    });
    expect(events.some((event) => event.kind === "error")).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
