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

/** Anthropic `messages`: content blocks with base64 image sources. */
export function toAnthropicMessages(
  messages: ChatMessage[],
): Array<{ role: string; content: unknown }> {
  return messages.map((m) => {
    const imgs = images(m)
    if (imgs.length === 0) return { role: m.role, content: m.content }
    return {
      role: m.role,
      content: [
        ...(m.content ? [{ type: 'text', text: m.content }] : []),
        ...imgs.map((a) => ({
          type: 'image',
          source: { type: 'base64', media_type: a.mimeType, data: a.data },
        })),
      ],
    }
  })
}

/** OpenAI-compatible `messages`: content parts with `image_url` data URIs. */
export function toOpenAiMessages(
  messages: ChatMessage[],
): Array<{ role: string; content: unknown }> {
  return messages.map((m) => {
    const imgs = images(m)
    if (imgs.length === 0) return { role: m.role, content: m.content }
    return {
      role: m.role,
      content: [
        ...(m.content ? [{ type: 'text', text: m.content }] : []),
        ...imgs.map((a) => ({
          type: 'image_url',
          image_url: { url: `data:${a.mimeType};base64,${a.data}` },
        })),
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
