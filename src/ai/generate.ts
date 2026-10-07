import { stepCountIs, streamText, tool, type ToolSet } from "ai";
import type { ObjectId, Scape } from "@/core/types";
import { anthropicProvider, describeProviderError } from "./provider";
import { systemPrompt, userPrompt, type GenerationMode, type Scope } from "./prompt";
import { toolDescriptions, toolInputSchemas, TOOL_NAMES, type ToolName } from "./tools";
import { createApplier, type Applier, type ApplyOptions, type DoneEvent } from "./applier";

export * from "./applier";

/** Enough steps for the model to create, then connect, then refine. */
const MAX_STEPS = 12;

export interface GenerateOptions extends ApplyOptions {
  request: string;
  scape: Scape;
  selection?: ObjectId[];
  /** Whether the selection is the subject of the request or merely what happens to be clicked. */
  scope?: Scope;
  /** The scape's starter, describing what kind of document this is. */
  starterHint?: string;
  /** `connect` swaps in a prompt that only rewires the existing graph. */
  mode?: GenerationMode;
  /** The user's standing instructions: browser-wide, and this scape's own. Both optional. */
  instructions?: { global?: string; scape?: string };
  apiKey: string;
  modelId: string;
  signal?: AbortSignal;
}

export interface GenerateResult {
  txId: string;
  applied: number;
  skipped: number;
  cancelled: boolean;
}

/**
 * A prompt becomes a stream of validated actions that land one at a time.
 *
 * Everything here is deliberate about *not* waiting: each tool call is parsed, applied and
 * announced the moment it arrives. Awaiting the whole stream and applying at the end would
 * be simpler, and would throw away the only part of this the user actually remembers.
 *
 * Every action carries the same txId, so the whole generation is one press of undo.
 */
export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const applier = createApplier(options);

  const offered = options.allowedTools ?? TOOL_NAMES;
  const tools: ToolSet = Object.fromEntries(
    offered.map((name: ToolName) => [
      name,
      tool({
        description: toolDescriptions(options.allowedTypes)[name],
        inputSchema: toolInputSchemas[name],
        execute: async (input: unknown) => applier.apply(name, input),
      }),
    ]),
  );

  const prompt = userPrompt(options.request, options.scape, {
    ...(options.selection ? { selection: options.selection } : {}),
    ...(options.scope ? { scope: options.scope } : {}),
  });

  try {
    const model = anthropicProvider.model(options.modelId, options.apiKey);

    const result = streamText({
      model,
      system: systemPrompt({
        ...(options.allowedTypes ? { allowedTypes: options.allowedTypes } : {}),
        ...(options.starterHint ? { starterHint: options.starterHint } : {}),
        ...(options.mode ? { mode: options.mode } : {}),
        ...(options.instructions ? { instructions: options.instructions } : {}),
      }),
      prompt: prompt.text,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      ...(options.signal ? { abortSignal: options.signal } : {}),
    });

    // Consuming fullStream is what drives execution. Tool calls are applied inside
    // `execute` as they arrive, so nothing here waits for the whole response.
    for await (const part of result.fullStream) {
      if (part.type === "error") throw part.error;
    }
  } catch (error) {
    // Cancelling is not a failure: actions already applied stay, and they undo together.
    const cancelled =
      options.signal?.aborted === true ||
      (error as { name?: string })?.name === "AbortError" ||
      /abort/i.test(error instanceof Error ? error.message : "");

    if (!cancelled) {
      options.onEvent({ kind: "error", ...describeProviderError(error) });
      const failed = summarize(applier, options.modelId, false);
      options.onEvent(failed);
      return toResult(failed);
    }
  }

  applier.finish();
  const done = summarize(applier, options.modelId, options.signal?.aborted === true);
  options.onEvent(done);
  return toResult(done);
}

function summarize(applier: Applier, model: string, cancelled: boolean): DoneEvent {
  return {
    kind: "done",
    txId: applier.txId,
    applied: applier.applied(),
    skipped: applier.skipped(),
    model,
    cancelled,
  };
}

const toResult = (done: DoneEvent): GenerateResult => ({
  txId: done.txId,
  applied: done.applied,
  skipped: done.skipped,
  cancelled: done.cancelled,
});
