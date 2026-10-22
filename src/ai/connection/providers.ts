import { MODELS, type ModelChoice } from "@/ai/models";
import { SETTING_KEYS } from "@/core/types";

export type ProviderId = "claude-plan" | "chatgpt" | "anthropic";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** One line on what it uses and who bills it. */
  summary: string;
  /** Where the chosen model for this connection is remembered. */
  modelKey: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  "claude-plan": {
    id: "claude-plan",
    name: "Claude plan",
    summary: "Uses your Claude subscription through Claude Code.",
    modelKey: "ai.claudePlan.model",
  },
  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT plan",
    summary: "Uses your ChatGPT subscription.",
    modelKey: "ai.chatgpt.model",
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic API key",
    summary: "Billed to your Anthropic API account, separately from any subscription.",
    modelKey: SETTING_KEYS.model,
  },
};

export interface ProviderEnvironment {
  desktop: boolean;
  /** The developer preview at 127.0.0.1, which can sign in to ChatGPT through Vite. */
  localDev: boolean;
}

/**
 * Connections in the order they are offered; the first is the default. Subscriptions come
 * before the API key so nobody lands on separate API billing without choosing it. The hosted
 * web app can only reach Claude through an API key.
 */
export function availableProviders({ desktop, localDev }: ProviderEnvironment): ProviderId[] {
  if (desktop) return ["claude-plan", "chatgpt", "anthropic"];
  if (localDev) return ["anthropic", "chatgpt"];
  return ["anthropic"];
}

export function isProviderId(value: unknown): value is ProviderId {
  return value === "claude-plan" || value === "chatgpt" || value === "anthropic";
}

export const CLAUDE_PLAN_MODELS: ModelChoice[] = [
  {
    id: "claude-plan/sonnet",
    label: "Claude Sonnet",
    tier: "standard",
    hint: "Balanced speed and quality. Web search is unavailable.",
  },
  {
    id: "claude-plan/haiku",
    label: "Claude Haiku",
    tier: "instant",
    hint: "Fastest. Best for small edits.",
  },
  {
    id: "claude-plan/opus",
    label: "Claude Opus",
    tier: "deep",
    hint: "Slowest and most capable. Uses more of your plan.",
  },
];

/** Stands in while ChatGPT has no account, so the model picker is never empty. */
export const CHATGPT_PLACEHOLDER: ModelChoice = {
  id: "chatgpt/unavailable",
  label: "Connect ChatGPT",
  tier: "standard",
  hint: "Connect ChatGPT in Settings → AI to choose a model.",
};

export function modelsFor(
  provider: ProviderId,
  chatgptModels: { id: string; label: string }[],
): ModelChoice[] {
  if (provider === "claude-plan") return CLAUDE_PLAN_MODELS;
  if (provider === "anthropic") return MODELS;
  if (!chatgptModels.length) return [CHATGPT_PLACEHOLDER];
  return chatgptModels.map((model) => ({
    ...model,
    tier: "standard",
    hint: "Availability and limits depend on your ChatGPT plan.",
  }));
}
