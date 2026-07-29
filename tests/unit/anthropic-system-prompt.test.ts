import { describe, it, expect } from 'vitest'
import { createAnthropicProvider } from '../../src/main/providers/anthropic.js'
import type { FetchLike } from '../../src/main/providers/types.js'
import type { ChatMessage } from '../../src/shared/types.js'

function emptyStreamResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.close() },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

interface AnthropicRequestBody {
  system?: string
  messages: { role: string; content: string }[]
}

/** Drives streamChat to completion against a capturing fetch stub, returning the JSON request body Anthropic's provider actually sent. */
async function captureRequestBody(messages: ChatMessage[]): Promise<AnthropicRequestBody> {
  let captured: AnthropicRequestBody | undefined
  const fetch: FetchLike = (_url, init) => {
    captured = JSON.parse(init.body as string) as AnthropicRequestBody
    return Promise.resolve(emptyStreamResponse())
  }
  const provider = createAnthropicProvider()
  const events = provider.streamChat(
    { model: 'claude-test', messages, config: { apiKey: 'k', fetch } },
    new AbortController().signal,
  )
  for await (const _event of events) { /* drain to guarantee fetch was awaited */ }
  if (!captured) throw new Error('fetch was never called')
  return captured
}

describe('anthropic provider: system prompt hoisting', () => {
  it('hoists and joins multiple system messages into a single top-level `system` field', async () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'system', content: 'Be terse.', createdAt: 0 },
      { id: '2', role: 'system', content: 'Never apologize.', createdAt: 1 },
      { id: '3', role: 'user', content: 'hi', createdAt: 2 },
    ]
    const body = await captureRequestBody(messages)
    expect(body.system).toBe('Be terse.\nNever apologize.')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('omits the `system` field entirely when there is no system message', async () => {
    const messages: ChatMessage[] = [{ id: '1', role: 'user', content: 'hi', createdAt: 0 }]
    const body = await captureRequestBody(messages)
    expect(body).not.toHaveProperty('system')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('hoists a system message that is not first in the array, without disturbing message order', async () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'user', content: 'hi', createdAt: 0 },
      { id: '2', role: 'system', content: 'Be terse.', createdAt: 1 },
      { id: '3', role: 'assistant', content: 'ok', createdAt: 2 },
    ]
    const body = await captureRequestBody(messages)
    expect(body.system).toBe('Be terse.')
    expect(body.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok' },
    ])
  })
})
