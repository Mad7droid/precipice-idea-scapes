import { describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { consumeResponses, portableHistory, runChatGPT } from "./runtime";

const encoder = new TextEncoder();
const event = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const completed = (output: unknown[] = []) => ({
  type: "response.completed",
  response: { status: "completed", output },
});
const stream = (text: string, bytewise = false) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const bytes = encoder.encode(text);
      if (bytewise) for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      else controller.enqueue(bytes);
      controller.close();
    },
  });
function fetcherFor(...responses: string[]) {
  return vi.fn(async (url: RequestInfo | URL) =>
    String(url).endsWith("/status")
      ? new Response(JSON.stringify({ status: "connected", connectionId: "account-a" }))
      : new Response(stream(responses.shift() ?? event(completed())), {
          headers: { "content-type": "text/event-stream" },
        }),
  );
}
const options = {
  modelId: "chatgpt/account-model",
  instructions: "Keep Ask read-only",
  input: [{ role: "user", content: "hello" }],
  tools: {},
  maxSteps: 3,
};
describe("ChatGPT subscription runtime", () => {
  it("handles SSE split inside UTF-8 and CRLF boundaries", async () => {
    const events: unknown[] = [];
    await consumeResponses(
      stream(
        event({ type: "response.output_text.delta", delta: "नमस्ते 👋" }) + event(completed()),
        true,
      ),
      (value) => events.push(value),
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ delta: "नमस्ते 👋" });
  });
  it("uses only portable text when crossing providers", () => {
    const history = portableHistory([
      {
        user: { role: "user", content: "Question" },
        response: [
          {
            role: "assistant",
            content: [
              { type: "reasoning", text: "PRIVATE REASONING" },
              { type: "text", text: "Answer" },
              { type: "tool-call", toolCallId: "a", toolName: "internal", input: {} },
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "a",
                toolName: "internal",
                output: { type: "text", value: "PRIVATE TOOL" },
              },
            ],
          },
        ],
      },
    ]);
    expect(history).toEqual([
      { role: "user", content: "Question" },
      { role: "assistant", content: "Answer" },
    ]);
  });
  it("requires a completed terminal event and executes no partial tool call", async () => {
    const execute = vi.fn();
    const fetcher = fetcherFor(
      event({
        type: "response.output_item.done",
        item: {
          type: "function_call",
          name: "change",
          namespace: "precipice",
          call_id: "a",
          arguments: "{}",
        },
      }),
    );
    await expect(
      runChatGPT({
        ...options,
        tools: { change: tool({ inputSchema: z.object({}), execute }) },
        fetcher,
      }),
    ).rejects.toThrow("before completion");
    expect(execute).not.toHaveBeenCalled();
  });
  it("executes validated tools once and returns their outputs in the next step", async () => {
    const execute = vi.fn(async ({ title }: { title: string }) => ({ saved: title }));
    const call = {
      type: "function_call",
      name: "change",
      namespace: "precipice",
      call_id: "call-a",
      arguments: '{"title":"Roadmap"}',
    };
    const fetcher = fetcherFor(
      event(completed([call])),
      event({ type: "response.output_text.delta", delta: "Done" }) + event(completed()),
    );
    const result = await runChatGPT({
      ...options,
      tools: { change: tool({ inputSchema: z.object({ title: z.string() }), execute }) },
      fetcher,
    });
    expect(result).toBe("Done");
    expect(execute).toHaveBeenCalledTimes(1);
    const request = JSON.parse(
      (fetcher.mock.calls[2] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(request.connectionId).toBe("account-a");
    expect(request.input).toContainEqual({
      type: "function_call_output",
      call_id: "call-a",
      output: '{"saved":"Roadmap"}',
    });
    expect(request.tools[0]).toMatchObject({ type: "namespace", name: "precipice" });
  });
  it("refuses tools absent from the read-only capability set", async () => {
    const fetcher = fetcherFor(
      event(
        completed([
          {
            type: "function_call",
            name: "DeleteObject",
            namespace: "precipice",
            call_id: "a",
            arguments: "{}",
          },
        ]),
      ),
    );
    await expect(runChatGPT({ ...options, fetcher })).rejects.toThrow("unavailable");
  });
  it("does not execute invalid arguments or duplicate calls", async () => {
    const execute = vi.fn();
    const call = {
      type: "function_call",
      name: "change",
      namespace: "precipice",
      call_id: "call-a",
      arguments: '{"title":12}',
    };
    const fetcher = fetcherFor(event(completed([call])), event(completed([call])));
    await expect(
      runChatGPT({
        ...options,
        tools: { change: tool({ inputSchema: z.object({ title: z.string() }), execute }) },
        fetcher,
      }),
    ).rejects.toThrow("repeated");
    expect(execute).not.toHaveBeenCalled();
  });
  it("aborts before dispatching a completed operation", async () => {
    const abort = new AbortController();
    abort.abort();
    const fetcher = fetcherFor(event(completed()));
    await expect(runChatGPT({ ...options, signal: abort.signal, fetcher })).rejects.toThrow();
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("responses"))).toHaveLength(0);
  });
});
