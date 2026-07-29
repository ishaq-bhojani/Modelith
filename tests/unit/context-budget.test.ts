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
    // Must return user with assistant, not a lone assistant.
    expect(result.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(result.omittedCount).toBe(1)
  })

  it('never begins with an assistant message when any user message survives', () => {
    const testCases = [
      {
        name: 'original repro 1: ending in assistant',
        input: [
          msg('u1', 'user', 'x'.repeat(400)),
          msg('a1', 'assistant', 'x'.repeat(400)),
          msg('u2', 'user', 'x'.repeat(400)),
          msg('a2', 'assistant', 'y'),
        ],
        maxTokens: 60,
      },
      {
        name: 'original repro 2: leading user run',
        input: [
          msg('u1', 'user', 'x'),
          msg('u2', 'user', 'y'),
          msg('a1', 'assistant', 'x'.repeat(4000)),
        ],
        maxTokens: 20,
      },
      {
        name: 'leading assistant with user later',
        input: [
          msg('a1', 'assistant', 'x'.repeat(400)),
          msg('a2', 'assistant', 'y'),
          msg('u1', 'user', 'z'),
        ],
        maxTokens: 10,
      },
      {
        name: 'assistant-only history',
        input: [
          msg('a1', 'assistant', 'x'.repeat(4000)),
          msg('a2', 'assistant', 'y'),
        ],
        maxTokens: 10,
      },
    ]
    for (const testCase of testCases) {
      const result = applyContextBudget(testCase.input, testCase.maxTokens)
      const inputHasUser = testCase.input.some((m) => m.role === 'user')
      if (inputHasUser) {
        expect(
          result.messages.some((m) => m.role === 'user'),
          `${testCase.name}: result must retain at least one user message`,
        ).toBe(true)
        expect(
          result.messages[0]?.role !== 'assistant',
          `${testCase.name}: result must not begin with assistant when user survives`,
        ).toBe(true)
      }
    }
  })
})
