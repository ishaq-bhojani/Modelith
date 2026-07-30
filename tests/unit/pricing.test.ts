import { describe, it, expect } from 'vitest'
import { costOf, PRICING } from '../../src/main/cost/pricing.js'

describe('costOf', () => {
  it('computes cost from input and output tokens', () => {
    // Pick a real entry so the test tracks the shipped table.
    const key = 'anthropic:claude-sonnet-4-6'
    const price = PRICING[key]
    expect(price).toBeDefined()
    const usage = { promptTokens: 1_000_000, completionTokens: 1_000_000 }
    const cost = costOf(usage, 'anthropic', 'claude-sonnet-4-6')
    expect(cost).toBeCloseTo((price!.inputPerMTok + price!.outputPerMTok), 6)
  })

  it('scales linearly with token counts', () => {
    const full = costOf({ promptTokens: 1_000_000, completionTokens: 0 }, 'anthropic', 'claude-sonnet-4-6')
    const half = costOf({ promptTokens: 500_000, completionTokens: 0 }, 'anthropic', 'claude-sonnet-4-6')
    expect(full).not.toBeNull()
    expect(half).toBeCloseTo(full! / 2, 6)
  })

  it('returns 0 for zero usage on a known model', () => {
    expect(costOf({ promptTokens: 0, completionTokens: 0 }, 'anthropic', 'claude-sonnet-4-6')).toBe(0)
  })

  it('returns null for a model with no price entry rather than guessing', () => {
    expect(costOf({ promptTokens: 100, completionTokens: 100 }, 'anthropic', 'no-such-model')).toBeNull()
  })

  it('returns null when usage is absent', () => {
    expect(costOf(undefined, 'anthropic', 'claude-sonnet-4-6')).toBeNull()
  })

  it('treats a missing token field as zero', () => {
    const cost = costOf({ promptTokens: 1_000_000 }, 'anthropic', 'claude-sonnet-4-6')
    expect(cost).toBeCloseTo(PRICING['anthropic:claude-sonnet-4-6']!.inputPerMTok, 6)
  })

  it('prices local providers at zero, not null', () => {
    // A local runtime genuinely costs nothing; that is a real 0, not "unknown".
    expect(costOf({ promptTokens: 5000, completionTokens: 5000 }, 'ollama', 'llama3.1:8b')).toBe(0)
  })
})
