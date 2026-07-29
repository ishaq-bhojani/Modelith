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

  it('describes a context_overflow as the conversation being too long, not a generic malformed request', () => {
    // The user sees this message right next to a "Retry with fewer messages"
    // action (ErrorNotice.tsx) — it must actually say the conversation is too
    // long, not reuse the `unknown` branch's "malformed or too long" wording.
    const body = JSON.stringify({ error: { message: "This model's maximum context length is 128000 tokens." } })
    const result = statusToError(400, { body })
    expect(result.message).toMatch(/too long/i)
    expect(result.message).not.toMatch(/malformed/i)
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

describe('statusToError 429 branch', () => {
  it('parses a Retry-After header into retryAfterSeconds', () => {
    const result = statusToError(429, { retryAfter: '42' })
    expect(result).toMatchObject({ kind: 'rate_limit', retryAfterSeconds: 42 })
  })

  it('omits retryAfterSeconds when there is no Retry-After header', () => {
    const result = statusToError(429, {})
    expect(result.kind).toBe('rate_limit')
    expect(result).not.toHaveProperty('retryAfterSeconds')
  })

  it('omits retryAfterSeconds when the Retry-After header is not a number', () => {
    const result = statusToError(429, { retryAfter: 'not-a-number' })
    expect(result.kind).toBe('rate_limit')
    expect(result).not.toHaveProperty('retryAfterSeconds')
  })
})
