export interface ModelChoice {
  id: string;
  label: string;
  hint: string;
}

/**
 * Current Anthropic aliases. Keeping this catalogue dependency-free lets the UI display model
 * choices without downloading the provider SDK before the user starts a generation.
 */
export const MODELS: ModelChoice[] = [
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    hint: "Fast and good at structured output. The default.",
  },
  {
    id: "claude-sonnet-5-5",
    label: "Sonnet 5.5",
    hint: "The newest Sonnet, at the same price as Sonnet 5.",
  },
  {
    id: "claude-opus-5",
    label: "Opus 5",
    hint: "Slower and pricier. Better on genuinely hard briefs.",
  },
  {
    id: "claude-opus-5-5",
    label: "Opus 5.5",
    hint: "The newest Opus, and cheaper than Opus 5. Best on genuinely hard briefs.",
  },
];

export const DEFAULT_MODEL = MODELS[0].id;
