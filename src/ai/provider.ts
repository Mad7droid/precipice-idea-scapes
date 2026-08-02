import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

/**
 * Anthropic only in v1.
 *
 * Structured so a second provider is a new file next to this one implementing `Provider`,
 * not a refactor of everything that calls it. The second provider is deliberately not built.
 */
export interface Provider {
  id: string;
  label: string;
  models: ModelChoice[];
  /** Throws if a direct key is missing — callers surface that as "add a key in settings". */
  model: (modelId: string, apiKey: string) => LanguageModel;
}

export interface ModelChoice {
  id: string;
  label: string;
  hint: string;
}

/**
 * Model ids are exact. Do not append date suffixes — the aliases below are complete.
 * Sonnet 5 is the default: near-Opus quality on structured, tool-heavy work at a fraction
 * of the cost, which matters when a single prompt emits twenty tool calls.
 */
export const MODELS: ModelChoice[] = [
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    hint: "Fast and good at structured output. The default.",
  },
  {
    id: "claude-opus-4-8",
    label: "Opus 4.8",
    hint: "Slower and pricier. Better on genuinely hard briefs.",
  },
];

export const DEFAULT_MODEL = MODELS[0].id;

export class MissingApiKeyError extends Error {
  constructor() {
    super("No Anthropic API key. Add one in settings.");
  }
}

export const anthropicProvider: Provider = {
  id: "anthropic",
  label: "Anthropic",
  models: MODELS,
  model(modelId, apiKey) {
    const usingProxyFallback = apiKey === "proxy";
    if (!usingProxyFallback && !apiKey?.trim()) throw new MissingApiKeyError();
    // The browser always talks to our Cloudflare Worker. When a user supplies a key, the
    // Worker forwards it for this request without storing it; otherwise it can use its own
    // server-side secret. The key never becomes part of the generated application bundle.
    const provider = createAnthropic({
      apiKey: usingProxyFallback ? "server-managed" : apiKey,
      baseURL: import.meta.env.VITE_AI_PROXY_URL ?? "https://precipice-ai-proxy.precipice.workers.dev",
    });
    return provider(modelId);
  },
};

/** Turns provider failures into copy that says what happened and what to do about it. */
export function describeProviderError(error: unknown): { message: string; detail: string } {
  if (error instanceof MissingApiKeyError) {
    return { message: "No API key", detail: "Add an Anthropic API key in settings, then try again." };
  }

  const raw = error instanceof Error ? error.message : String(error);
  const status = (error as { statusCode?: number })?.statusCode;

  if (status === 401 || /authentication|invalid x-api-key/i.test(raw)) {
    return {
      message: "That API key was rejected",
      detail: "Check the key in settings. It should start with sk-ant-.",
    };
  }
  if (status === 429 || /rate.?limit/i.test(raw)) {
    return {
      message: "Rate limited by Anthropic",
      detail: "Wait a moment and run the prompt again.",
    };
  }
  if (status === 529 || /overloaded/i.test(raw)) {
    return { message: "Anthropic is overloaded", detail: "Try again in a few seconds." };
  }
  if (/fetch|network|Failed to fetch/i.test(raw)) {
    return { message: "Could not reach Anthropic", detail: "Check your connection and try again." };
  }
  return { message: "Generation failed", detail: raw };
}
