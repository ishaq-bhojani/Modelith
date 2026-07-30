import { costOf } from '@shared/pricing'
import type { Usage } from '@shared/types'

/**
 * Formats a turn's cost for display. Returns null (render nothing) when the cost
 * is unknown — no usage recorded or no price for the model — so the UI shows a
 * badge only when it has a real number, never a misleading zero.
 */
export function formatCost(usage: Usage | undefined, provider: string | undefined, model: string | undefined): string | null {
  if (!provider || !model) return null
  const cost = costOf(usage, provider, model)
  if (cost === null) return null
  if (cost === 0) return '$0'
  if (cost < 0.01) return '<$0.01'
  return `$${cost.toFixed(cost < 1 ? 3 : 2)}`
}

/** Sums cost across messages, ignoring those with unknown cost. */
export function sessionCost(
  messages: { usage?: Usage; provider?: string; model?: string }[],
): number {
  let total = 0
  for (const m of messages) {
    if (!m.provider || !m.model) continue
    const c = costOf(m.usage, m.provider, m.model)
    if (c !== null) total += c
  }
  return total
}

export function formatTotal(total: number): string | null {
  if (total <= 0) return null
  if (total < 0.01) return '<$0.01'
  return `$${total.toFixed(total < 1 ? 3 : 2)}`
}
