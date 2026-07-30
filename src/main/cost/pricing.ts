import type { Usage } from '../../shared/types.js'

export interface ModelPrice {
  /** USD per million input (prompt) tokens. */
  inputPerMTok: number
  /** USD per million output (completion) tokens. */
  outputPerMTok: number
}

/**
 * Published list prices in USD per million tokens, keyed `provider:model`.
 *
 * This is deliberately plain, PR-editable data: prices change often, and a
 * contributor adding a model should not have to touch any logic. A model with
 * no entry costs `null` (shown as "—"), never a wrong number derived from a
 * default. Local runtimes are keyed with an empty price and handled as a true
 * zero in `costOf`, since they genuinely cost nothing to run.
 *
 * Figures are approximate and for display only — the app never bills anyone.
 */
export const PRICING: Record<string, ModelPrice> = {
  // Anthropic
  'anthropic:claude-opus-4-6': { inputPerMTok: 15, outputPerMTok: 75 },
  'anthropic:claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
  'anthropic:claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
  // Kimi / Moonshot
  'kimi:moonshot-v1-128k': { inputPerMTok: 2, outputPerMTok: 5 },
  'kimi:kimi-k2': { inputPerMTok: 0.6, outputPerMTok: 2.5 },
  // DeepSeek
  'deepseek:deepseek-chat': { inputPerMTok: 0.27, outputPerMTok: 1.1 },
  'deepseek:deepseek-reasoner': { inputPerMTok: 0.55, outputPerMTok: 2.19 },
  // Groq
  'groq:llama-3.3-70b-versatile': { inputPerMTok: 0.59, outputPerMTok: 0.79 },
}

/** Providers whose models run locally and therefore cost nothing. */
const LOCAL_PROVIDERS = new Set(['ollama', 'lmstudio'])

/**
 * Derives the USD cost of one turn from its recorded token usage.
 *
 * Returns `null` — meaning "unknown", to be shown as "—" — when usage is absent
 * or the model has no price entry. Returns a real `0` for local providers and
 * for genuinely zero usage. Never invents a price.
 */
export function costOf(usage: Usage | undefined, provider: string, model: string): number | null {
  if (LOCAL_PROVIDERS.has(provider)) return 0
  if (!usage) return null
  const price = PRICING[`${provider}:${model}`]
  if (!price) return null
  const input = (usage.promptTokens ?? 0) / 1_000_000
  const output = (usage.completionTokens ?? 0) / 1_000_000
  return input * price.inputPerMTok + output * price.outputPerMTok
}
