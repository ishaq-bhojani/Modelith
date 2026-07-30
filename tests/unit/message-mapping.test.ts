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

describe('message mapping — tool calls and results', () => {
  const convo: ChatMessage[] = [
    { id: '1', role: 'user', content: 'edit the file', createdAt: 0 },
    {
      id: '2', role: 'assistant', content: '', createdAt: 1,
      toolCalls: [{ id: 'call_1', name: 'write_file', arguments: '{"path":"a.txt","content":"x"}' }],
    },
    { id: '3', role: 'tool', content: 'Applied change to a.txt.', toolCallId: 'call_1', createdAt: 2 },
  ]

  it('openai serialises tool_calls on the assistant and role:tool results', () => {
    const out = toOpenAiMessages(convo)
    expect(out[1]).toEqual({
      role: 'assistant', content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'write_file', arguments: '{"path":"a.txt","content":"x"}' } }],
    })
    expect(out[2]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'Applied change to a.txt.' })
  })

  it('anthropic serialises tool_use blocks and tool_result as a user turn', () => {
    const out = toAnthropicMessages(convo)
    expect(out[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'call_1', name: 'write_file', input: { path: 'a.txt', content: 'x' } }],
    })
    expect(out[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'Applied change to a.txt.' }],
    })
  })

  it('anthropic merges consecutive tool results into one user turn', () => {
    const two: ChatMessage[] = [
      { id: '3', role: 'tool', content: 'r1', toolCallId: 'c1', createdAt: 0 },
      { id: '4', role: 'tool', content: 'r2', toolCallId: 'c2', createdAt: 1 },
    ]
    const out = toAnthropicMessages(two)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'c1', content: 'r1' },
        { type: 'tool_result', tool_use_id: 'c2', content: 'r2' },
      ],
    })
  })
})
