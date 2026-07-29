import { parseSse } from '../chat/sse-parser.js'
import { statusToError } from './openai-compat.js'
import type { ChatRequest, Provider, ProviderConfig } from './types.js'
import type { ModelInfo, StreamEvent } from '../../shared/types.js'

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1'

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

      const decoder = new TextDecoder()
      const reader = response.body.getReader()
      let residual = ''

      try {
        for (;;) {
          if (signal.aborted) break
          let result: Awaited<ReturnType<typeof reader.read>>
          try {
            result = await reader.read()
          } catch {
            // The underlying stream rejected the pending read — most commonly
            // because `signal` (shared with the fetch call) fired mid-read.
            if (signal.aborted) break
            yield { type: 'error', error: { kind: 'network', message: 'The response stream ended unexpectedly.' } }
            return
          }
          if (result.done) break
          const { value } = result

          const parsed = parseSse(decoder.decode(value, { stream: true }), residual)
          residual = parsed.residual

          for (const record of parsed.events) {
            let payload: {
              type?: string
              delta?: { type?: string; text?: string; thinking?: string }
              error?: { message?: string }
            }
            try { payload = JSON.parse(record.data) } catch { continue }

            if (payload.type === 'error') {
              // Anthropic can report an error mid-stream after a 200 response;
              // the message text itself is provider-authored and not echoed.
              yield { type: 'error', error: { kind: 'unknown', message: 'The provider reported an error.' } }
              return
            }
            if (payload.type === 'message_stop') { yield { type: 'done' }; return }
            if (payload.delta?.type === 'thinking_delta' && payload.delta.thinking) {
              yield { type: 'reasoning', delta: payload.delta.thinking }
            }
            if (payload.delta?.type === 'text_delta' && payload.delta.text) {
              yield { type: 'text', delta: payload.delta.text }
            }
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined)
      }

      yield { type: 'done' }
    },
  }
}
