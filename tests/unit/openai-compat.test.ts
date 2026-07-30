import { describe, it, expect } from 'vitest'
import { runProviderContract } from '../contract/provider-contract.js'
import { openAiCompatFixtures } from '../fixtures/openai-compat.js'
import { createOpenAiCompatProvider } from '../../src/main/providers/openai-compat.js'
import type { FetchLike } from '../../src/main/providers/types.js'

const make = () => createOpenAiCompatProvider({
  id: 'kimi',
  label: 'Kimi (Moonshot)',
  defaultBaseUrl: 'https://api.moonshot.cn/v1',
})

runProviderContract('openai-compat', make, openAiCompatFixtures)

describe('openai-compat temperature passthrough', () => {
  // Captures the outgoing request body so we can assert what actually reaches
  // the wire, rather than trusting the request was shaped correctly.
  function capturingFetch(captured: { body?: string }): FetchLike {
    return (_url, init) => {
      captured.body = init.body as string
      return Promise.resolve(
        new Response('data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      )
    }
  }

  async function drain(it: AsyncIterable<unknown>): Promise<void> { for await (const _ of it) { /* consume */ } }

  it('includes temperature in the request body when set', async () => {
    const captured: { body?: string } = {}
    await drain(make().streamChat({
      model: 'm',
      temperature: 0.2,
      messages: [{ id: '1', role: 'user', content: 'hi', createdAt: 0 }],
      config: { apiKey: 'k', fetch: capturingFetch(captured) },
    }, new AbortController().signal))
    expect(JSON.parse(captured.body ?? '{}').temperature).toBe(0.2)
  })

  it('omits temperature entirely when not set', async () => {
    const captured: { body?: string } = {}
    await drain(make().streamChat({
      model: 'm',
      messages: [{ id: '1', role: 'user', content: 'hi', createdAt: 0 }],
      config: { apiKey: 'k', fetch: capturingFetch(captured) },
    }, new AbortController().signal))
    expect('temperature' in JSON.parse(captured.body ?? '{}')).toBe(false)
  })
})
