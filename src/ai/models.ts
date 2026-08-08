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
    id: "claude-opus-5",
    label: "Opus 5",
    hint: "Slower and pricier. Better on genuinely hard briefs.",
  },
];

export const DEFAULT_MODEL = MODELS[0].id;
