import { asSchema, type ModelMessage, type ToolSet } from "ai";

export const isChatGPTModel = (model: string) => model.startsWith("chatgpt/");
interface OutputItem {
  type: string;
  name?: string;
  namespace?: string;
  call_id?: string;
  arguments?: string;
  encrypted_content?: string;
  content?: {
    type: string;
    text?: string;
    annotations?: { type: string; url?: string; title?: string }[];
  }[];
  [key: string]: unknown;
}
interface RuntimeOptions {
  modelId: string;
  instructions: string;
  input: unknown[];
  tools: ToolSet;
  maxSteps: number;
  signal?: AbortSignal;
  webSearch?: boolean;
  onText?: (text: string) => void;
  onSource?: (source: { id: string; url: string; title: string }) => void;
  fetcher?: typeof fetch;
}

/** Portable text only across provider changes. Never replays Anthropic internal/tool records. */
export function portableHistory(history: { user: ModelMessage; response: ModelMessage[] }[]) {
  return history
    .flatMap((turn) => [turn.user, ...turn.response])
    .flatMap((message) => {
      if (message.role !== "user" && message.role !== "assistant") return [];
      const text =
        typeof message.content === "string"
          ? message.content
          : message.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n");
      return text ? [{ role: message.role, content: text }] : [];
    });
}

/** SSE can split UTF-8, JSON and delimiters at any byte; completion is explicit, never inferred from EOF. */
export async function consumeResponses(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parse = (frame: string) => {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data && data !== "[DONE]") onEvent(JSON.parse(data));
  };
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 2_000_000)
        throw new Error("ChatGPT response exceeded the stream buffer limit.");
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        parse(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
      if (done) {
        if (buffer.trim()) parse(buffer);
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Bounded tool loop using the same tool schemas/executors as the existing canvas pipeline. */
export async function runChatGPT(options: RuntimeOptions): Promise<string> {
  const fetcher = options.fetcher ?? fetch;
  const statusResponse = await fetcher("/__chatgpt/status", {
    credentials: "same-origin",
    cache: "no-store",
    signal: options.signal,
  });
  const status = await statusResponse.json();
  if (
    !statusResponse.ok ||
    status.status !== "connected" ||
    typeof status.connectionId !== "string"
  )
    throw new Error("Connect ChatGPT in Settings → AI first.");
  const input = [...options.input];
  const functions = await Promise.all(
    Object.entries(options.tools).map(async ([name, tool]) => ({
      type: "function",
      name,
      description: tool.description,
      parameters: await asSchema(tool.inputSchema).jsonSchema,
      strict: false,
    })),
  );
  const tools: unknown[] = functions.length
    ? [
        {
          type: "namespace",
          name: "precipice",
          description: "Operations available for this Precipice request.",
          tools: functions,
        },
      ]
    : [];
  if (options.webSearch) tools.push({ type: "web_search" });
  const seen = new Set<string>();
  let answer = "";
  for (let step = 0; step < options.maxSteps; step++) {
    options.signal?.throwIfAborted();
    const response = await fetcher("/__chatgpt/responses", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        connectionId: status.connectionId,
        model: options.modelId.slice("chatgpt/".length),
        instructions: options.instructions,
        input,
        tools,
      }),
      signal: options.signal,
    });
    if (!response.ok) {
      const message = await response.json().catch(() => null);
      throw new Error(
        typeof message?.error === "string"
          ? message.error
          : "ChatGPT could not complete the request. Reconnect or try later.",
      );
    }
    if (!response.body) throw new Error("ChatGPT returned no response stream.");
    let output: OutputItem[] | null = null;
    await consumeResponses(
      response.body,
      (event) => {
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          answer += event.delta;
          options.onText?.(event.delta);
        }
        if (
          event.type === "response.failed" ||
          event.type === "response.incomplete" ||
          event.type === "error"
        )
          throw new Error(
            "ChatGPT did not complete this response. Retry the request or check your plan usage.",
          );
        if (event.type === "response.completed") {
          const result = event.response as { status?: string; output?: OutputItem[] } | undefined;
          if (result?.status !== "completed" || !Array.isArray(result.output))
            throw new Error("ChatGPT returned an incomplete response.");
          output = result.output;
        }
      },
      options.signal,
    );
    if (!output) throw new Error("ChatGPT stream ended before completion. Retry the request.");
    const items = output as OutputItem[];
    for (const item of items)
      for (const part of item.content ?? [])
        for (const source of part.annotations ?? []) {
          if (source.type === "url_citation" && source.url)
            options.onSource?.({
              id: source.url,
              url: source.url,
              title: source.title ?? source.url,
            });
        }
    const calls = items.filter((item) => item.type === "function_call");
    if (!calls.length) return answer;
    // Encrypted reasoning may be needed for continuation. Never expose it in the visible transcript.
    input.push(
      ...items.filter(
        (item) => item.type !== "reasoning" || typeof item.encrypted_content === "string",
      ),
    );
    for (const call of calls) {
      options.signal?.throwIfAborted();
      const name = call.name ?? "";
      if (
        call.namespace !== "precipice" ||
        !Object.hasOwn(options.tools, name) ||
        !call.call_id ||
        seen.has(call.call_id)
      )
        throw new Error(
          "ChatGPT requested an unavailable or repeated operation. No operation was repeated.",
        );
      seen.add(call.call_id);
      const tool = options.tools[name];
      if (!tool.execute || typeof call.arguments !== "string")
        throw new Error("ChatGPT returned an invalid operation.");
      let value: unknown;
      try {
        value = JSON.parse(call.arguments);
      } catch {
        throw new Error("ChatGPT returned invalid operation arguments.");
      }
      const schema = asSchema(tool.inputSchema);
      const validated = await schema.validate?.(value);
      if (!validated?.success) {
        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: "Invalid arguments. Use the declared schema and try again.",
        });
        continue;
      }
      const result = await tool.execute(validated.value, {
        toolCallId: call.call_id,
        messages: [],
        context: undefined,
        abortSignal: options.signal,
      });
      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(result) ?? "null",
      });
    }
  }
  throw new Error(
    "ChatGPT reached the step limit. Changes already applied can be undone together.",
  );
}
