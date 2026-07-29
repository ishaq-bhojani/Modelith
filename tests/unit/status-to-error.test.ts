import { describe, it, expect } from 'vitest'
import { statusToError } from '../../src/main/providers/openai-compat.js'

describe('statusToError 400 branch', () => {
  it('maps a context-length-exceeded body to context_overflow', () => {
    const body = JSON.stringify({
      error: { message: "This model's maximum context length is 128000 tokens." },
    })
    expect(statusToError(400, { body })).toMatchObject({ kind: 'context_overflow' })
  })

  it('maps a "too many tokens" body to context_overflow', () => {
    const body = JSON.stringify({ error: { message: 'Request contains too many tokens for this model.' } })
    expect(statusToError(400, { body })).toMatchObject({ kind: 'context_overflow' })
  })

  it('maps an unrelated 400 (bad model name) to unknown, not context_overflow', () => {
    const body = JSON.stringify({ error: { message: 'The model `gpt-nonexistent` does not exist.' } })
    const result = statusToError(400, { body })
    expect(result.kind).toBe('unknown')
    expect(result.kind).not.toBe('context_overflow')
  })

  it('maps a 400 with no body at all to unknown', () => {
    expect(statusToError(400)).toMatchObject({ kind: 'unknown' })
  })
})
