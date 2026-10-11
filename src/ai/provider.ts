import { isDesktop } from "@/desktop/runtime";
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
    // Web requests use the CORS Worker; desktop requests go directly to Anthropic.
    // Both use the user-owned credential, never a managed server-side key.
    const provider = createAnthropic({
      apiKey,
      ...transportSettings(),
    });
    return provider(modelId);
  },
};

/** The language model and Anthropic-hosted tools must share the same BYOK proxy settings. */
export function anthropicClient(apiKey: string): AnthropicProvider {
  if (!apiKey?.trim()) throw new MissingApiKeyError();
  return createAnthropic({ apiKey, ...transportSettings() });
}

/**
 * The parts of a provider failure that are safe to reason about.
 *
 * Failures arrive in two shapes. A rejected request is an `Error` (the SDK's `APICallError`)
 * carrying `statusCode`. A failure *mid-stream* — overloaded, rate limited, an API error after
 * the first token — is Anthropic's SSE error payload passed through as a plain
 * `{ type, message }` object, sometimes wrapped as `{ type: "error", error: { … } }`. Reading
 * only `Error#message` turned every mid-stream failure into "[object Object]", and so into the
 * generic message, hiding even an ordinary "overloaded".
 */
export function providerErrorFacts(error: unknown): {
  status?: number;
  type?: string;
  message: string;
} {
  const record = (value: unknown) =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  const outer = record(error);
  const inner = record(outer?.error) ?? outer;
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);
  const type = text(inner?.type) !== "error" ? text(inner?.type) : undefined;
  const status = typeof outer?.statusCode === "number" ? outer.statusCode : undefined;
  const message =
    error instanceof Error ? error.message : (text(inner?.message) ?? text(error) ?? "");
  return { ...(status ? { status } : {}), ...(type ? { type } : {}), message };
}

/** Turns provider failures into safe, actionable copy. Raw provider diagnostics stay out of the UI. */
export function describeProviderError(error: unknown): { message: string; detail: string } {
  if (error instanceof MissingApiKeyError) {
    return {
      message: "No API key",
      detail: "Add an Anthropic API key in settings, then try again.",
    };
  }

  const { status, type, message: raw } = providerErrorFacts(error);

  if (
    status === 401 ||
    type === "authentication_error" ||
    /authentication|invalid x-api-key/i.test(raw)
  ) {
    return {
      message: "Scapi could not connect",
      detail: "Check the API key in settings, then try again.",
    };
  }
  if (
    /reached your specified API usage limits|(?:monthly|spend|usage) limit (?:reached|exceeded)/i.test(
      raw,
    )
  ) {
    // Only copy the fixed-format reset timestamp, never the provider's full diagnostic.
    const reset = raw.match(/regain access on (\d{4}-\d{2}-\d{2}) at (\d{2}:\d{2}) UTC/i);
    return {
      message: "Anthropic API usage limit reached",
      detail:
        "Increase the API account’s usage limit in Anthropic Console, or wait for it to reset." +
        (reset ? ` Access resets ${reset[1]} at ${reset[2]} UTC.` : ""),
    };
  }
  if (status === 429 || type === "rate_limit_error" || /rate.?limit/i.test(raw)) {
    return {
      message: "Scapi is temporarily busy",
      detail: "Wait a moment, then try again.",
    };
  }
  if (
    status === 404 ||
    type === "not_found_error" ||
    /model.*(not found|not available)|invalid.*model/i.test(raw)
  ) {
    return {
      message: "Model unavailable",
      detail: "Choose a supported Anthropic model and try again.",
    };
  }
  if (status === 529 || type === "overloaded_error" || /overloaded/i.test(raw)) {
    return { message: "Scapi is temporarily busy", detail: "Try again in a few seconds." };
  }
  if (/fetch|network|Failed to fetch/i.test(raw)) {
    return { message: "Could not reach Anthropic", detail: "Check your connection and try again." };
  }
  if (status === 413 || /request too large|prompt is too long/i.test(raw)) {
    return {
      message: "This conversation is too large",
      detail: "Clear the Scapi conversation or ask about selected objects, then try again.",
    };
  }
  if (/credit balance|billing|insufficient credits/i.test(raw)) {
    return {
      message: "Anthropic credits unavailable",
      detail: "Check the API account’s billing and credit balance, then try again.",
    };
  }
  if (status === 403 || type === "permission_error") {
    return {
      message: "Scapi access was denied",
      detail: "Check the API key’s permissions and model access, then try again.",
    };
  }
  if ((status !== undefined && status >= 500) || type === "api_error") {
    return {
      message: "Anthropic is temporarily unavailable",
      detail: "Try again in a few moments.",
    };
  }
  // The provider's own text can echo request content, so it never reaches the UI. Its status
  // and error type are a fixed vocabulary, and they are what makes a report diagnosable.
  const reference = [status && `HTTP ${status}`, type && /^[a-z_]+$/.test(type) && type]
    .filter(Boolean)
    .join(" · ");
  return {
    message: "Something went wrong",
    detail:
      "Scapi could not complete this response. Please try again." +
      (reference ? ` Reference: ${reference}.` : ""),
  };
}

export function transportSettings() {
  return isDesktop()
    ? {
        baseURL: "https://api.anthropic.com/v1",
        headers: { "anthropic-dangerous-direct-browser-access": "true" },
      }
    : { baseURL: proxyBaseUrl() };
}
