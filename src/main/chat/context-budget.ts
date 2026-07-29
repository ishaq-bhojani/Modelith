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
 * Groups messages into exchanges. Each exchange begins at a user message and
 * absorbs the assistant replies that follow it, so dropping a whole group can
 * never orphan an assistant reply. Any leading non-user messages form their
 * own group, which is only ever retained when it is the last one left.
 */
function groupExchanges(messages: ChatMessage[]): ChatMessage[][] {
  const groups: ChatMessage[][] = []
  for (const message of messages) {
    const startsExchange = message.role === 'user' || groups.length === 0
    if (startsExchange) groups.push([message])
    else groups[groups.length - 1]?.push(message)
  }
  return groups
}

/**
 * Trims history to fit `maxTokens` by dropping the oldest complete
 * user/assistant pairs. The system message is always retained, and the
 * final message is always retained even if it alone exceeds the budget.
 *
 * Trimming is reported via `omittedCount` so a caller *could* surface it
 * explicitly rather than truncate silently. As of this writing nothing in
 * the renderer actually renders `omittedCount` yet (stream-engine.ts's caller
 * deliberately leaves it unconsumed) — this is a known, deferred gap, not a
 * claim that the UI already shows it.
 */
export function applyContextBudget(messages: ChatMessage[], maxTokens: number): BudgetResult {
  const system = messages.filter((m) => m.role === 'system')
  const rest = messages.filter((m) => m.role !== 'system')

  const cost = (list: ChatMessage[]) =>
    list.reduce((sum, m) => sum + estimateTokens(m.content), 0)

  const systemCost = cost(system)
  const groups = groupExchanges(rest)

  let firstGroup = 0
  while (
    firstGroup < groups.length - 1 &&
    systemCost + cost(groups.slice(firstGroup).flat()) > maxTokens
  ) {
    firstGroup += 1
  }

  const kept = groups.slice(firstGroup).flat()

  return { messages: [...system, ...kept], omittedCount: rest.length - kept.length }
}
