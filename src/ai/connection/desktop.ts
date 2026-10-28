import { Channel, invoke as nativeInvoke } from "@tauri-apps/api/core";

function nativeError(value: unknown): Error {
  if (value instanceof Error) return value;
  const error = new Error(String(value));
  if (typeof value === "object" && value && "name" in value && value.name === "AbortError")
    error.name = "AbortError";
  return error;
}
async function invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await nativeInvoke<T>(command, args);
  } catch (error) {
    throw nativeError(error);
  }
}

/** Same stream contract as browser fetch; native code owns credentials and destination URLs. */
export async function desktopChatGPTFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const path = String(input);
  if (path === "/__chatgpt/status")
    return new Response(JSON.stringify(await invoke("chatgpt_status")), {
      headers: { "content-type": "application/json" },
    });
  if (path !== "/__chatgpt/responses") throw new Error("Unsupported desktop AI operation.");
  const body = JSON.parse(String(init?.body ?? "{}"));
  const stream = nativeStream("chatgpt_request", { body }, init?.signal ?? undefined);
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}

export function nativeStream(
  command: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const id = crypto.randomUUID();
  let cancel = () => {};
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let ended = false;
      const cleanup = () => signal?.removeEventListener("abort", abort);
      const finish = (error?: unknown) => {
        if (ended) return;
        ended = true;
        cleanup();
        if (error) controller.error(nativeError(error));
        else controller.close();
      };
      const abort = () => {
        if (ended) return;
        void invoke("ai_cancel", { id }).catch(() => {});
        finish(new DOMException("Request cancelled", "AbortError"));
      };
      cancel = () => {
        if (ended) return;
        ended = true;
        cleanup();
        void invoke("ai_cancel", { id }).catch(() => {});
      };
      if (signal?.aborted) return finish(new DOMException("Request cancelled", "AbortError"));
      signal?.addEventListener("abort", abort, { once: true });
      const onChunk = new Channel<number[]>();
      onChunk.onmessage = (bytes) => {
        if (!ended) controller.enqueue(new Uint8Array(bytes));
      };
      void invoke(command, { ...args, id, onChunk }).then(() => finish(), finish);
    },
    cancel() {
      cancel();
    },
  });
}

/** Claude Code supplies structured proposals; the shared runtime validates and executes tools. */
export function claudeFetcher(): typeof fetch {
  return async (input, init) => {
    if (String(input) === "/__chatgpt/status") {
      const status = await invoke<{ connected: boolean; email?: string; connectionId?: string }>(
        "claude_status",
        // Reuse the native 60-second account check rather than spawning Claude Code per request.
        { cached: true },
      );
      return new Response(
        JSON.stringify({
          status: status.connected ? "connected" : "disconnected",
          connectionId: status.connectionId ?? status.email ?? "claude-plan",
        }),
        { headers: { "content-type": "application/json" } },
      );
    }
    const body = JSON.parse(String(init?.body ?? "{}"));
    const id = crypto.randomUUID();
    const signal = init?.signal;
    signal?.throwIfAborted();
    const abort = () => {
      void invoke("ai_cancel", { id }).catch(() => {});
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const result = await invoke<{ text: string; calls: { name: string; arguments: string }[] }>(
        "claude_request",
        {
          id,
          model: body.model,
          connectionId: body.connectionId,
          prompt: JSON.stringify({
            instructions: body.instructions,
            policy:
              "You are Scapi in Precipice. Return text and calls matching the schema. Only request the offered Precipice tools. Tool results follow in input. Ask is read-only. You have no browser, filesystem or shell tools; do not claim external research. Finish with an empty calls array when done.",
            input: body.input,
            tools: body.tools,
          }),
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["text", "calls"],
            properties: {
              text: { type: "string" },
              calls: {
                type: "array",
                maxItems: 32,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["name", "arguments"],
                  properties: {
                    name: { type: "string" },
                    arguments: {
                      type: "string",
                      description: "JSON-encoded tool input matching its declared schema",
                    },
                  },
                },
              },
            },
          },
        },
      );
      signal?.throwIfAborted();
      if (
        typeof result.text !== "string" ||
        !Array.isArray(result.calls) ||
        result.calls.length > 32
      )
        throw new Error("Claude returned an invalid response. Try again.");
      const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
      return new Response(
        event({ type: "response.output_text.delta", delta: result.text }) +
          event({
            type: "response.completed",
            response: {
              status: "completed",
              output: result.calls.map((call) => ({
                type: "function_call",
                namespace: "precipice",
                name: call.name,
                arguments: call.arguments,
                call_id: crypto.randomUUID(),
              })),
            },
          }),
        { headers: { "content-type": "text/event-stream" } },
      );
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  };
}
