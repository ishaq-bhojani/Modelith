import { parseSse } from '../chat/sse-parser.js'
import type { ChatRequest, Provider, ProviderConfig } from './types.js'
import type { ModelInfo, ProviderError, StreamEvent } from '../../shared/types.js'

export interface OpenAiCompatSpec {
  id: string
  label: string
  defaultBaseUrl: string
}

export function statusToError(status: number, retryAfter?: string | null): ProviderError {
  if (status === 401 || status === 403) {
    return { kind: 'auth', message: 'The provider rejected the API key.' }
  }
  if (status === 429) {
    const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : Number.NaN
    return {
      kind: 'rate_limit',
      message: 'Rate limit reached.',
      ...(Number.isFinite(seconds) ? { retryAfterSeconds: seconds } : {}),
    }
  }
  if (status >= 500) {
    return { kind: 'provider_5xx', message: `The provider returned ${status}.` }
  }
  if (status === 400) {
    return { kind: 'context_overflow', message: 'The request was rejected as malformed or too long.' }
  }
  return { kind: 'unknown', message: `Unexpected status ${status}.` }
}

export function createOpenAiCompatProvider(spec: OpenAiCompatSpec): Provider {
  const urlFor = (config: ProviderConfig, path: string) =>
    `${(config.baseUrl ?? spec.defaultBaseUrl).replace(/\/$/, '')}${path}`

  return {
    id: spec.id,
    label: spec.label,
    defaultBaseUrl: spec.defaultBaseUrl,
    requiresKey: true,

    async listModels(config) {
      const response = await config.fetch(urlFor(config, '/models'), {
        headers: { authorization: `Bearer ${config.apiKey}` },
      })
      if (!response.ok) return []
      const body = (await response.json()) as { data?: { id?: string }[] }
      return (body.data ?? [])
        .filter((m): m is { id: string } => typeof m.id === 'string')
        .map((m): ModelInfo => ({ id: m.id, label: m.id, contextWindow: 128_000 }))
    },

    async *streamChat(request: ChatRequest, signal: AbortSignal) {
      const { config } = request
      let response: Response
      try {
        response = await config.fetch(urlFor(config, '/chat/completions'), {
          method: 'POST',
          signal,
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: request.model,
            stream: true,
            messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          }),
        })
      } catch (cause) {
        if (signal.aborted) { yield { type: 'done' } satisfies StreamEvent; return }
        yield { type: 'error', error: { kind: 'network', message: 'Could not reach the provider.' } }
        return
      }

      if (!response.ok) {
        yield { type: 'error', error: statusToError(response.status, response.headers.get('retry-after')) }
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
          const { done, value } = await reader.read()
          if (done) break

          const parsed = parseSse(decoder.decode(value, { stream: true }), residual)
          residual = parsed.residual

          for (const record of parsed.events) {
            if (record.data === '[DONE]') { yield { type: 'done' }; return }
            let payload: { choices?: { delta?: { content?: string; reasoning_content?: string } }[] }
            try { payload = JSON.parse(record.data) } catch { continue }
            const delta = payload.choices?.[0]?.delta
            if (delta?.reasoning_content) yield { type: 'reasoning', delta: delta.reasoning_content }
            if (delta?.content) yield { type: 'text', delta: delta.content }
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined)
      }

      yield { type: 'done' }
    },
  }
}
