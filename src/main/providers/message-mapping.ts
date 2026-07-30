import type { Attachment, ChatMessage } from '../../shared/types.js'

/**
 * Per-provider wire mapping for messages, including image attachments (spec
 * §B.2). The critical invariant: a message with NO attachments maps to exactly
 * what the providers sent before this existed — `{ role, content: <string> }` —
 * so text-only requests are byte-identical and no existing behaviour regresses.
 * Only when a message carries images does `content` become a parts array.
 */

function images(m: ChatMessage): Attachment[] {
  return (m.attachments ?? []).filter((a) => a.type === 'image')
}

/** Anthropic `messages`: content blocks with base64 images and tool use/results.
 *  Tool result messages become `user` turns carrying `tool_result` blocks, and
 *  consecutive results are merged so roles still alternate. */
export function toAnthropicMessages(
  messages: ChatMessage[],
): Array<{ role: string; content: unknown }> {
  const out: Array<{ role: string; content: unknown }> = []
  for (const m of messages) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }
      const last = out[out.length - 1]
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        (last.content as unknown[]).push(block) // merge consecutive results
      } else {
        out.push({ role: 'user', content: [block] })
      }
      continue
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      out.push({
        role: 'assistant',
        content: [
          ...(m.content ? [{ type: 'text', text: m.content }] : []),
          ...m.toolCalls.map((tc) => ({ type: 'tool_use', id: tc.id, name: tc.name, input: safeJson(tc.arguments) })),
        ],
      })
      continue
    }
    const imgs = images(m)
    if (imgs.length === 0) { out.push({ role: m.role, content: m.content }); continue }
    out.push({
      role: m.role,
      content: [
        ...(m.content ? [{ type: 'text', text: m.content }] : []),
        ...imgs.map((a) => ({ type: 'image', source: { type: 'base64', media_type: a.mimeType, data: a.data } })),
      ],
    })
  }
  return out
}

function safeJson(raw: string): unknown {
  try { return JSON.parse(raw || '{}') } catch { return {} }
}

/** OpenAI-compatible `messages`: image parts plus `tool_calls` / role:'tool'. */
export function toOpenAiMessages(
  messages: ChatMessage[],
): Array<Record<string, unknown>> {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments },
        })),
      }
    }
    const imgs = images(m)
    if (imgs.length === 0) return { role: m.role, content: m.content }
    return {
      role: m.role,
      content: [
        ...(m.content ? [{ type: 'text', text: m.content }] : []),
        ...imgs.map((a) => ({ type: 'image_url', image_url: { url: `data:${a.mimeType};base64,${a.data}` } })),
      ],
    }
  })
}

/** Ollama `messages`: text content plus a sibling `images: [base64]` array. */
export function toOllamaMessages(
  messages: ChatMessage[],
): Array<{ role: string; content: string; images?: string[] }> {
  return messages.map((m) => {
    const imgs = images(m)
    if (imgs.length === 0) return { role: m.role, content: m.content }
    return { role: m.role, content: m.content, images: imgs.map((a) => a.data) }
  })
}
