import { stepCountIs, streamText, type ModelMessage } from "ai";
import { anthropicClient, describeProviderError } from "@/ai/provider";
import type { ObjectId, Scape } from "@/core/types";
import { responseTokenBudget } from "./answerFormat";
import { questionBlock, scapeContextBlock, scapiSystemPrompt } from "./scapiPrompt";
import { scapiTools } from "./scapiTools";
import type { AskEvent, ModelTurn } from "./types";

/**
 * One question, answered.
 *
 * The counterpart to `generate()`: same provider, same error vocabulary, same "stream and report
 * as it arrives" shape. The difference is that nothing here can reach the reducer — Scapi has
 * only read tools, so the entire result of this function is text on a screen.
 */

/** Enough for the model to search, read a few objects, then answer. */
const MAX_STEPS = 6;

/**
 * How much conversation the model is given back.
 *
 * Whole turns, from the end. Never a partial turn: see `ModelTurn` for why a `user` without its
 * `response` (or the reverse) is a correctness bug rather than a size saving.
 */
export const HISTORY_TURNS = 6;

/**
 * `low` is the default on purpose. This feature was specified interaction-first, and on current
 * models low effort answers a question about a document you already handed it very well while
 * being markedly faster — and speed is the thing a user feels on every single turn.
 */
const EFFORT = "low";

export interface AskOptions {
  question: string;
  scape: Scape;
  /** Complete prior turns, oldest first. Trimmed here, not by the caller. */
  history: ModelTurn[];
  /** Objects the user had selected when they asked. */
  pinned?: ObjectId[];
  apiKey: string;
  modelId: string;
  signal?: AbortSignal;
  /** Web search is an enhancement, never a condition for asking about the canvas. */
  webSearch?: boolean;
  onEvent: (event: AskEvent) => void;
}

/**
 * Builds the exact message array sent to the provider.
 *
 * Exported because it is the one part of this file worth testing without a network, and because
 * the invariant it carries is easy to break by accident: `result.response.messages` contains
 * only assistant and tool messages, so the user's own question has to be re-attached from the
 * turn that produced it. Flatten a `ModelTurn` and you get question-then-answer; drop the `user`
 * half and the model is reading a monologue.
 */
export function assembleMessages(
  scape: Scape,
  history: ModelTurn[],
  question: string,
  pinned: ObjectId[] = [],
): ModelMessage[] {
  const scapeMessage: ModelMessage = {
    role: "user",
    content: [
      {
        type: "text",
        text: scapeContextBlock(scape),
        // The cached prefix. It must stay byte-identical between turns, which is why the
        // question and the selection are in a separate message below rather than appended here.
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
    ],
  };

  const recent = history.slice(-HISTORY_TURNS);
  const past = recent.flatMap((turn) => [turn.user, ...turn.response]);

  return [scapeMessage, ...past, userMessage(question, pinned, scape)];
}

function userMessage(question: string, pinned: ObjectId[], scape: Scape): ModelMessage {
  return { role: "user", content: questionBlock(question, pinned, scape) };
}

export async function ask(options: AskOptions): Promise<void> {
  await runAsk(options, options.webSearch ?? true);
}

async function runAsk(
  options: AskOptions,
  webSearch: boolean,
  retriedWithoutSearch = false,
  retriedWithoutHistory = false,
): Promise<void> {
  const { onEvent, scape, signal } = options;
  const pinned = options.pinned ?? [];
  const sent = userMessage(options.question, pinned, scape);

  let sawReasoning = false;
  let sawText = false;

  // Reported before anything is awaited. It is true — the projection below reads every object —
  // and it means the panel has something specific to say during the longest silence in the
  // whole exchange, which is the wait for the model's first token.
  onEvent({
    kind: "activity",
    event: { kind: "reading-scape", objects: scape.objectOrder.length },
  });

  try {
    const client = anthropicClient(options.apiKey);
    const tools = scapiTools({
      scape,
      onActivity: (event) => onEvent({ kind: "activity", event }),
    });
    if (webSearch) {
      tools.web_search = client.tools.webSearch_20260209({ maxUses: 3 });
    }

    const result = streamText({
      model: client(options.modelId),
      system: scapiSystemPrompt(),
      maxOutputTokens: responseTokenBudget(options.question),
      messages: assembleMessages(scape, options.history, options.question, pinned),
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      providerOptions: {
        anthropic: {
          // `summarized` is what makes the reasoning panel possible at all — the default
          // omits the text and streams empty thinking blocks.
          thinking: { type: "adaptive", display: "summarized" },
          effort: EFFORT,
        },
      },
      ...(signal ? { abortSignal: signal } : {}),
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "reasoning-delta":
          if (!sawReasoning) {
            sawReasoning = true;
            onEvent({ kind: "activity", event: { kind: "thinking" } });
          }
          onEvent({ kind: "reasoning", text: part.text });
          break;

        case "text-delta":
          if (!sawText) {
            sawText = true;
            onEvent({ kind: "activity", event: { kind: "writing" } });
          }
          onEvent({ kind: "text", text: part.text });
          break;

        case "source":
          if (part.sourceType === "url") {
            onEvent({
              kind: "source",
              source: { id: part.id, url: part.url, title: part.title ?? part.url },
            });
          }
          break;

        case "error":
          throw part.error;
      }
    }

    // Only reached when the stream completed. `response.messages` is assistant/tool messages
    // only, so it is paired with the question we sent to form one indivisible turn.
    const response = await result.response;
    onEvent({ kind: "done", turn: { user: sent, response: response.messages } });
  } catch (error) {
    const cancelled =
      signal?.aborted === true ||
      (error as { name?: string })?.name === "AbortError" ||
      /abort/i.test(error instanceof Error ? error.message : "");

    const unavailable = webSearch && isWebSearchUnavailable(error);
    if (unavailable && !retriedWithoutSearch && !cancelled) {
      // Account-level search access is configured in Anthropic's Console. Retry immediately
      // without that tool so an Ask turn remains useful instead of becoming a dead end.
      onEvent({ kind: "search-unavailable" });
      await runAsk(options, false, true);
      return;
    }
    if (
      !cancelled &&
      !sawText &&
      options.history.length > 0 &&
      !retriedWithoutHistory &&
      isMalformedToolHistory(error)
    ) {
      // Tool transcript records are provider-shaped and normally replay safely. If a provider
      // rejects one of its own internal records, preserve the visible transcript but retry this
      // question with a fresh model context rather than showing a dead-end error.
      onEvent({ kind: "history-reset" });
      await runAsk({ ...options, history: [] }, webSearch, retriedWithoutSearch, true);
      return;
    }
    if (!cancelled) onEvent({ kind: "error", ...describeProviderError(error) });

    // Nothing partial is ever recorded. A half-turn in history is worse than a lost one: it
    // leaves a question the model will try to answer again, or an answer to no question.
    onEvent({ kind: "done", turn: null });
  }
}

export function isMalformedToolHistory(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:code_execution|tool use).*without a corresponding.*tool.result/i.test(message);
}

export function isWebSearchUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /web[ _-]?search|search.*(?:enable|permission|allow|available)/i.test(message);
}
