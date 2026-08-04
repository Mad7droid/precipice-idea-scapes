import { stepCountIs, streamText, tool, type ToolSet } from "ai";
import { actionSchema, describeAction, type Action } from "@/core/actions";
import { newTxId } from "@/core/ids";
import { getPlugin } from "@/core/registry";
import type { ObjectId, Scape } from "@/core/types";
import { anthropicProvider, describeProviderError } from "./provider";
import { systemPrompt, userPrompt } from "./prompt";
import { isToolName, toolDescriptions, toolInputSchemas, TOOL_NAMES, type ToolName } from "./tools";

/** Re-running Dagre on every action makes the canvas thrash; every third is invisible. */
const LAYOUT_EVERY = 3;
/** Enough steps for the model to create, then connect, then refine. */
const MAX_STEPS = 12;

export interface AppliedEvent {
  kind: "applied";
  action: Action;
  /** One mono line for the ribbon: `CreateObject · journey · "Verify identity"`. */
  line: string;
}

export interface SkippedEvent {
  kind: "skipped";
  tool: string;
  reason: string;
  input: unknown;
}

export interface DoneEvent {
  kind: "done";
  txId: string;
  applied: number;
  skipped: number;
  model: string;
  cancelled: boolean;
}

export interface ErrorEvent {
  kind: "error";
  message: string;
  detail: string;
}

export type GenerationEvent = AppliedEvent | SkippedEvent | DoneEvent | ErrorEvent;

export interface ApplyOptions {
  /** Injected so the apply loop is testable without a store, a canvas or a network. */
  dispatch: (action: Action) => boolean;
  onEvent: (event: GenerationEvent) => void;
  /** Wired to the canvas by the app shell, so this module never imports src/canvas. */
  requestLayout?: () => void;
  txId?: string;
  /**
   * Object types this generation may create. Empty or absent means no constraint.
   *
   * The prompt already asks for the constraint, but asking is not enforcing — a model that
   * creates a wireframe anyway would silently defeat the control, so the request is also
   * enforced here and the offender lands in the "N actions skipped" count like any other
   * invalid action.
   */
  allowedTypes?: string[];
}

export interface Applier {
  txId: string;
  /** Returns the tool result string that goes back to the model. */
  apply: (toolName: string, input: unknown) => string;
  applied: () => number;
  skipped: () => number;
  createdIds: () => ObjectId[];
  /** One last layout, so the final objects are not left stacked at the origin. */
  finish: () => void;
}

/**
 * The apply loop, extracted so a live generation and a recorded one exercise exactly the
 * same code. A fixture that replays through a parallel implementation tests the fixture.
 */
export function createApplier(options: ApplyOptions): Applier {
  const txId = options.txId ?? newTxId();
  const created: ObjectId[] = [];
  let applied = 0;
  let skipped = 0;

  const skip = (toolName: string, reason: string, input: unknown): string => {
    skipped += 1;
    options.onEvent({ kind: "skipped", tool: toolName, reason, input });
    return `Rejected: ${reason}`;
  };

  const apply = (toolName: string, input: unknown): string => {
    if (!isToolName(toolName)) return skip(toolName, "not a known action", input);

    const candidate = { ...(input as object), type: toolName, txId, ts: Date.now() };

    // Zod-parse every action, even though the tool schema already validated the input. This
    // is the boundary where a model's output becomes state, and it is the reducer's schema —
    // not the tool's — that decides what the reducer can actually accept.
    const parsed = actionSchema.safeParse(candidate);
    if (!parsed.success) {
      return skip(
        toolName,
        parsed.error.issues
          .map((i) => `${i.path.join(".") || "root"}: ${i.message.toLowerCase()}`)
          .join("; "),
        input,
      );
    }

    const action = parsed.data;

    // A CreateObject whose data does not satisfy the plugin's own schema would render as a
    // broken card, so it is rejected here rather than later and more confusingly.
    if (action.type === "CreateObject") {
      const plugin = getPlugin(action.objectType);
      if (!plugin) return skip(toolName, `unknown object type "${action.objectType}"`, input);

      const allowed = options.allowedTypes ?? [];
      if (allowed.length > 0 && !allowed.includes(action.objectType)) {
        return skip(toolName, `${action.objectType} was excluded from this generation`, input);
      }

      const data = plugin.schema.safeParse(action.data ?? plugin.defaults());
      if (!data.success) {
        return skip(
          toolName,
          `data does not match the ${action.objectType} shape: ${data.error.issues
            .map((i) => `${i.path.join(".") || "root"} ${i.message.toLowerCase()}`)
            .join("; ")}`,
          input,
        );
      }
      action.data = data.data as Record<string, unknown>;
    }

    // The reducer is the final word: it drops an edge whose endpoints do not exist, and
    // anything else that would be a no-op.
    if (!options.dispatch(action)) {
      return skip(
        toolName,
        action.type === "ConnectObjects"
          ? "one or both endpoints do not exist"
          : "no effect on the current scape",
        input,
      );
    }

    applied += 1;
    if (action.type === "CreateObject") created.push(action.id);
    options.onEvent({
      kind: "applied",
      action,
      line: `${action.type} · ${describeAction(action)}`,
    });

    // Reflow every few actions rather than every one — the canvas would thrash otherwise.
    if (applied % LAYOUT_EVERY === 0) options.requestLayout?.();

    return "Applied.";
  };

  return {
    txId,
    apply,
    applied: () => applied,
    skipped: () => skipped,
    createdIds: () => [...created],
    finish: () => {
      if (applied > 0) options.requestLayout?.();
    },
  };
}

export interface GenerateOptions extends ApplyOptions {
  request: string;
  scape: Scape;
  selection?: ObjectId[];
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

  const tools: ToolSet = Object.fromEntries(
    TOOL_NAMES.map((name: ToolName) => [
      name,
      tool({
        description: toolDescriptions()[name],
        inputSchema: toolInputSchemas[name],
        execute: async (input: unknown) => applier.apply(name, input),
      }),
    ]),
  );

  const prompt = userPrompt(options.request, options.scape, {
    ...(options.selection ? { selection: options.selection } : {}),
  });

  try {
    const model = anthropicProvider.model(options.modelId, options.apiKey);

    const result = streamText({
      model,
      system: systemPrompt(options.allowedTypes),
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
