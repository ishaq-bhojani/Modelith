import { parseSse } from '../chat/sse-parser.js'
import { statusToError } from './openai-compat.js'
import { consumeStream, type ChunkResult } from './stream-consumer.js'
import type { ChatRequest, Provider, ProviderConfig } from './types.js'
import type { ModelInfo, StreamEvent } from '../../shared/types.js'

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1'

/** Per-stream SSE framing for Anthropic's `messages` streaming wire format. */
function makeAnthropicChunkHandler(): (chunk: string) => ChunkResult {
  let residual = ''
  return (chunk) => {
    const parsed = parseSse(chunk, residual)
    residual = parsed.residual

    const events: StreamEvent[] = []
    for (const record of parsed.events) {
      let payload: {
        type?: string
        delta?: { type?: string; text?: string; thinking?: string }
      }
      try {
        payload = JSON.parse(record.data) as typeof payload
      } catch {
        continue
      }

      if (payload.type === 'error') {
        // Anthropic can report an error mid-stream after a 200 response;
        // the message text itself is provider-authored and not echoed.
        events.push({ type: 'error', error: { kind: 'unknown', message: 'The provider reported an error.' } })
        return { events, stop: true }
      }
      if (payload.type === 'message_stop') return { events, complete: true }
      if (payload.delta?.type === 'thinking_delta' && payload.delta.thinking) {
        events.push({ type: 'reasoning', delta: payload.delta.thinking })
      }
      if (payload.delta?.type === 'text_delta' && payload.delta.text) {
        events.push({ type: 'text', delta: payload.delta.text })
      }
    }
    return { events }
  }
}

export function createAnthropicProvider(): Provider {
  const urlFor = (config: ProviderConfig, path: string) =>
    `${(config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')}${path}`

  const headers = (config: ProviderConfig) => ({
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  })

  return {
    id: 'anthropic',
    label: 'Anthropic',
    defaultBaseUrl: DEFAULT_BASE_URL,
    requiresKey: true,

    async listModels(config) {
      const response = await config.fetch(urlFor(config, '/models'), { headers: headers(config) })
      if (!response.ok) return []
      let body: { data?: { id?: string; display_name?: string }[] }
      try {
        body = (await response.json()) as { data?: { id?: string; display_name?: string }[] }
      } catch {
        return []
      }
      return (body.data ?? [])
        .filter((m): m is { id: string; display_name?: string } => typeof m.id === 'string')
        .map((m): ModelInfo => ({ id: m.id, label: m.display_name ?? m.id, contextWindow: 200_000 }))
    },

    async *streamChat(request: ChatRequest, signal: AbortSignal) {
      const { config } = request
      // Anthropic takes the system prompt as a top-level field, not a message.
      const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n')
      const turns = request.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content }))

      let response: Response
      try {
        response = await config.fetch(urlFor(config, '/messages'), {
          method: 'POST',
          signal,
          headers: headers(config),
          body: JSON.stringify({
            model: request.model,
            max_tokens: 8192,
            stream: true,
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
            ...(system ? { system } : {}),
            messages: turns,
          }),
        })
      } catch {
        if (signal.aborted) { yield { type: 'done' } satisfies StreamEvent; return }
        yield { type: 'error', error: { kind: 'network', message: 'Could not reach the provider.' } }
        return
      }

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '')
        yield {
          type: 'error',
          error: statusToError(response.status, {
            retryAfter: response.headers.get('retry-after'),
            body: bodyText,
          }),
        }
        return
      }
      if (!response.body) {
        yield { type: 'error', error: { kind: 'network', message: 'The provider returned an empty body.' } }
        return
      }

      yield* consumeStream(response.body, signal, makeAnthropicChunkHandler())
    },
  }
}
