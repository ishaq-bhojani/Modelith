import type { ChatMessage } from '../../shared/types.js'

/** Character-count heuristic. Adequate for budgeting; not a tokenizer. */
export function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.max(1, Math.ceil(text.length / 4))
}

export interface BudgetResult {
  messages: ChatMessage[]
  omittedCount: number
}

/**
 * Trims history to fit `maxTokens` by dropping the oldest complete
 * user/assistant pairs. The system message is always retained, and the
 * final message is always retained even if it alone exceeds the budget.
 *
 * Trimming is reported via `omittedCount` so the UI can show it explicitly.
 * Silent truncation is not acceptable: it removes information the user
 * believes is still present.
 */
export function applyContextBudget(messages: ChatMessage[], maxTokens: number): BudgetResult {
  const system = messages.filter((m) => m.role === 'system')
  const rest = messages.filter((m) => m.role !== 'system')

  const cost = (list: ChatMessage[]) =>
    list.reduce((sum, m) => sum + estimateTokens(m.content), 0)

  const systemCost = cost(system)
  let start = 0

  while (start < rest.length - 1 && systemCost + cost(rest.slice(start)) > maxTokens) {
    // Drop a whole exchange: a user message plus any assistant reply that follows it.
    start += 1
    while (start < rest.length - 1 && rest[start]?.role === 'assistant') start += 1
  }

  return { messages: [...system, ...rest.slice(start)], omittedCount: start }
}
