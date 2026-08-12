import { createAnthropic, type AnthropicProvider } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { MODELS, type ModelChoice } from "./models";

export { DEFAULT_MODEL, MODELS } from "./models";
export type { ModelChoice } from "./models";

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

const DEFAULT_PROXY_ORIGIN = "https://precipice-ai-proxy.precipice.workers.dev";

/**
 * The AI SDK appends `/messages` to whatever base URL it is given — its own default is
 * `https://api.anthropic.com/v1`, so the version segment belongs in the base URL, not in the
 * path it builds.
 *
 * Handing it the bare Worker origin therefore produced requests to `/messages`, which the
 * Worker answers with 404, and `describeProviderError` maps any 404 to "Model unavailable" —
 * an error about the model for a request that never reached Anthropic. Keep `/v1` here rather
 * than in `VITE_AI_PROXY_URL` so the env var stays a plain origin.
 */
export function proxyBaseUrl(
  origin: string = import.meta.env.VITE_AI_PROXY_URL ?? DEFAULT_PROXY_ORIGIN,
): string {
  return `${origin.replace(/\/+$/, "")}/v1`;
}

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
      baseURL: proxyBaseUrl(),
    });
    return provider(modelId);
  },
};

/** The language model and Anthropic-hosted tools must share the same BYOK proxy settings. */
export function anthropicClient(apiKey: string): AnthropicProvider {
  if (!apiKey?.trim()) throw new MissingApiKeyError();
  return createAnthropic({ apiKey, baseURL: proxyBaseUrl() });
}

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
