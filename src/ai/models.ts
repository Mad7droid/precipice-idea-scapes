export interface ModelChoice {
  id: string;
  label: string;
  hint: string;
  /** What routing may pick this model for. Several models can share a tier; the first wins. */
  tier: ModelTier;
}

/**
 * Provider-neutral speed/quality bands. Routing chooses a tier, never a model id, so a second
 * provider only needs its own catalogue mapping tiers to models.
 */
export type ModelTier = "instant" | "standard" | "deep";

/**
 * Current Anthropic aliases. Keeping this catalogue dependency-free lets the UI display model
 * choices without downloading the provider SDK before the user starts a generation.
 */
export const MODELS: ModelChoice[] = [
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    hint: "Fast and good at structured output. The default.",
    tier: "standard",
  },
  {
    id: "claude-sonnet-5-5",
    label: "Sonnet 5.5",
    hint: "The newest Sonnet, at the same price as Sonnet 5.",
    tier: "standard",
  },
  {
    id: "claude-haiku-5-5",
    label: "Haiku 5.5",
    hint: "Instant. Best for small edits and single objects.",
    tier: "instant",
  },
  {
    id: "claude-opus-5",
    label: "Opus 5",
    hint: "Slower and pricier. Better on genuinely hard briefs.",
    tier: "deep",
  },
  {
    id: "claude-opus-5-5",
    label: "Opus 5.5",
    hint: "The newest Opus, and cheaper than Opus 5. Best on genuinely hard briefs.",
    tier: "deep",
  },
];

export const DEFAULT_MODEL = MODELS[0].id;

/** The newest model in each tier. Deepen always uses the deep tier, whatever was picked. */
const TIER_MODEL: Record<ModelTier, string> = {
  instant: "claude-haiku-5-5",
  standard: "claude-sonnet-5-5",
  deep: "claude-opus-5-5",
};

export function tierOf(modelId: string): ModelTier {
  if (modelId.startsWith("claude-plan/"))
    return modelId.endsWith("/haiku") ? "instant" : modelId.endsWith("/opus") ? "deep" : "standard";
  return MODELS.find((model) => model.id === modelId)?.tier ?? "standard";
}

/**
 * The model for a routed tier. A person's own pick wins inside its tier: someone who chose
 * Sonnet 5 keeps Sonnet 5 for standard requests rather than being moved to 5.5.
 */
export function modelForTier(tier: ModelTier, preferred: string): string {
  if (preferred.startsWith("chatgpt/")) return preferred;
  if (preferred.startsWith("claude-plan/"))
    return `claude-plan/${tier === "instant" ? "haiku" : tier === "deep" ? "opus" : "sonnet"}`;
  return tierOf(preferred) === tier ? preferred : TIER_MODEL[tier];
}

export function modelLabel(modelId: string): string {
  if (modelId.startsWith("claude-plan/"))
    return modelId.slice(12).replace(/^./, (letter) => letter.toUpperCase());
  return MODELS.find((model) => model.id === modelId)?.label ?? modelId;
}

/** Which service is doing the work, for "who is working" labels. Never a billing claim. */
export function describeModel(modelId: string): { provider: "Claude" | "ChatGPT"; model: string } {
  if (modelId.startsWith("chatgpt/")) return { provider: "ChatGPT", model: modelId.slice(8) };
  return { provider: "Claude", model: modelLabel(modelId) };
}
