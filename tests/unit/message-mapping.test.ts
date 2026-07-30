import { describe, it, expect } from 'vitest'
import {
  toAnthropicMessages,
  toOpenAiMessages,
  toOllamaMessages,
} from '../../src/main/providers/message-mapping.js'
import type { ChatMessage } from '../../src/shared/types.js'

const textOnly: ChatMessage[] = [
  { id: '1', role: 'user', content: 'hello', createdAt: 0 },
  { id: '2', role: 'assistant', content: 'hi', createdAt: 1 },
]

const withImage: ChatMessage[] = [
  {
    id: '1', role: 'user', content: 'what is this?', createdAt: 0,
    attachments: [{ type: 'image', mimeType: 'image/png', data: 'BASE64DATA' }],
  },
]

describe('message mapping — text-only is unchanged (no regression)', () => {
  it('anthropic passes a plain string content when there are no attachments', () => {
    expect(toAnthropicMessages(textOnly)).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ])
  })
  it('openai passes a plain string content when there are no attachments', () => {
    expect(toOpenAiMessages(textOnly)).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ])
  })
  it('ollama passes a plain string content and no images key when there are none', () => {
    const out = toOllamaMessages(textOnly)
    expect(out).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ])
    expect(out[0]).not.toHaveProperty('images')
  })
})

describe('message mapping — image attachments per provider wire shape', () => {
  it('anthropic uses base64 image source blocks after the text block', () => {
    expect(toAnthropicMessages(withImage)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'BASE64DATA' } },
        ],
      },
    ])
  })

  it('openai uses image_url data URIs', () => {
    expect(toOpenAiMessages(withImage)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,BASE64DATA' } },
        ],
      },
    ])
  })

  it('ollama uses a sibling images array of raw base64', () => {
    expect(toOllamaMessages(withImage)).toEqual([
      { role: 'user', content: 'what is this?', images: ['BASE64DATA'] },
    ])
  })

  it('omits the text block when the message has only an image', () => {
    const imageOnly: ChatMessage[] = [{
      id: '1', role: 'user', content: '', createdAt: 0,
      attachments: [{ type: 'image', mimeType: 'image/jpeg', data: 'X' }],
    }]
    const anthropic = toAnthropicMessages(imageOnly)[0] as { content: unknown[] }
    expect(anthropic.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'X' } },
    ])
  })
})
