import { describe, it, expect } from 'vitest'
import { applyContextBudget, estimateTokens } from '../../src/main/chat/context-budget.js'
import type { ChatMessage } from '../../src/shared/types.js'

const msg = (id: string, role: ChatMessage['role'], content: string): ChatMessage =>
  ({ id, role, content, createdAt: 0 })

describe('estimateTokens', () => {
  it('approximates four characters per token', () => {
    expect(estimateTokens('12345678')).toBe(2)
  })
  it('never returns zero for non-empty text', () => {
    expect(estimateTokens('a')).toBe(1)
  })
})

describe('applyContextBudget', () => {
  it('returns everything when under budget', () => {
    const input = [msg('1', 'user', 'hi'), msg('2', 'assistant', 'hello')]
    const result = applyContextBudget(input, 1000)
    expect(result.messages).toEqual(input)
    expect(result.omittedCount).toBe(0)
  })

  it('always retains the system message', () => {
    const input = [
      msg('s', 'system', 'you are helpful'),
      ...Array.from({ length: 20 }, (_, i) =>
        msg(String(i), i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(400)),
      ),
    ]
    const result = applyContextBudget(input, 200)
    expect(result.messages[0]?.role).toBe('system')
  })

  it('drops the oldest pairs first', () => {
    const input = [
      msg('u1', 'user', 'x'.repeat(400)),
      msg('a1', 'assistant', 'x'.repeat(400)),
      msg('u2', 'user', 'y'),
      msg('a2', 'assistant', 'y'),
    ]
    const result = applyContextBudget(input, 60)
    expect(result.messages.map((m) => m.id)).toEqual(['u2', 'a2'])
    expect(result.omittedCount).toBe(2)
  })

  it('drops in whole pairs, never a lone assistant reply', () => {
    const input = [
      msg('u1', 'user', 'x'.repeat(4000)),
      msg('a1', 'assistant', 'x'.repeat(4000)),
      msg('u2', 'user', 'z'),
    ]
    const result = applyContextBudget(input, 20)
    expect(result.messages.map((m) => m.role)).toEqual(['user'])
    expect(result.omittedCount).toBe(2)
  })

  it('keeps the final user message even if it alone exceeds the budget', () => {
    const input = [msg('u1', 'user', 'x'.repeat(10_000))]
    const result = applyContextBudget(input, 10)
    expect(result.messages).toHaveLength(1)
    expect(result.omittedCount).toBe(0)
  })

  it('trims a history ending in an assistant message without orphaning it', () => {
    const input = [
      msg('u1', 'user', 'x'.repeat(400)),
      msg('a1', 'assistant', 'x'.repeat(400)),
      msg('u2', 'user', 'x'.repeat(400)),
      msg('a2', 'assistant', 'y'),
    ]
    const result = applyContextBudget(input, 60)
    expect(result.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(result.omittedCount).toBe(2)
  })

  it('trims a leading run of user messages correctly', () => {
    const input = [
      msg('u1', 'user', 'x'),
      msg('u2', 'user', 'y'),
      msg('a1', 'assistant', 'x'.repeat(4000)),
    ]
    const result = applyContextBudget(input, 20)
    // Must trim away the oldest user message, not return a lone assistant.
    const roles = result.messages.map((m) => m.role)
    const firstUserIndex = roles.findIndex((r) => r === 'user')
    const firstAssistantIndex = roles.findIndex((r) => r === 'assistant')
    if (firstAssistantIndex !== -1 && firstUserIndex !== -1) {
      expect(firstUserIndex).toBeLessThan(firstAssistantIndex)
    }
    expect(result.omittedCount).toBeGreaterThan(0)
  })

  it('never begins with an assistant message when any user message survives', () => {
    const input = [
      msg('u1', 'user', 'x'.repeat(4000)),
      msg('a1', 'assistant', 'x'.repeat(4000)),
      msg('u2', 'user', 'z'),
    ]
    const result = applyContextBudget(input, 20)
    const firstUserIndex = result.messages.findIndex((m) => m.role === 'user')
    const firstAssistantIndex = result.messages.findIndex((m) => m.role === 'assistant')
    if (firstUserIndex !== -1 && firstAssistantIndex !== -1) {
      expect(firstUserIndex).toBeLessThan(firstAssistantIndex)
    }
  })
})
