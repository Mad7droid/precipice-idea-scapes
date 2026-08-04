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
 * Model ids are exact Anthropic API ids, and these are the current ones — bare aliases with
 * no date suffix. Dated snapshots retire: the previous pair, `claude-sonnet-4-20250514` and
 * `claude-opus-4-20250514`, reached end of life and started returning 404 "model not found",
 * which the UI surfaced as "Model unavailable". Prefer the undated alias so a snapshot
 * retirement can't break generation again.
 *
 * Sonnet stays the default for structured, tool-heavy work at a lower cost than Opus.
 */
export const MODELS: ModelChoice[] = [
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    hint: "Fast and good at structured output. The default.",
  },
  {
    id: "claude-opus-5",
    label: "Opus 5",
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
    if (!apiKey?.trim()) throw new MissingApiKeyError();
    // The browser always talks to our Cloudflare Worker, which exists to add CORS headers and
    // nothing else. It forwards this key for this request and stores neither it nor a key of
    // its own — a hosted key behind a public endpoint is a hosted key anyone can spend.
    const provider = createAnthropic({
      apiKey,
      baseURL:
        import.meta.env.VITE_AI_PROXY_URL ?? "https://precipice-ai-proxy.precipice.workers.dev",
    });
    return provider(modelId);
  },
};

/** Turns provider failures into copy that says what happened and what to do about it. */
export function describeProviderError(error: unknown): { message: string; detail: string } {
  if (error instanceof MissingApiKeyError) {
    return {
      message: "No API key",
      detail: "Add an Anthropic API key in settings, then try again.",
    };
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
  if (status === 404 || /model.*(not found|not available)|invalid.*model/i.test(raw)) {
    return {
      message: "Model unavailable",
      detail: "Choose a supported Anthropic model and try again.",
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
