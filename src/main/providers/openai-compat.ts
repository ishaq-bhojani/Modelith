import { parseSse } from '../chat/sse-parser.js'
import { toOpenAiMessages } from './message-mapping.js'
import { consumeStream, type ChunkResult } from './stream-consumer.js'
import type { ChatRequest, Provider, ProviderConfig } from './types.js'
import type { ModelInfo, ProviderError, StreamEvent } from '../../shared/types.js'

export interface OpenAiCompatSpec {
  id: string
  label: string
  defaultBaseUrl: string
}

/** Case-insensitive signal that a 400 was specifically about context length, not a bad model id or malformed request. */
const CONTEXT_OVERFLOW_PATTERN =
  /context (length|window)|maximum context|too many tokens|prompt is too long|reduce the length/i

export function statusToError(
  status: number,
  options?: { retryAfter?: string | null; body?: string },
): ProviderError {
  const retryAfter = options?.retryAfter
  const body = options?.body
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
    if (body && CONTEXT_OVERFLOW_PATTERN.test(body)) {
      return { kind: 'context_overflow', message: 'The conversation is too long for this model.' }
    }
    return { kind: 'unknown', message: 'The provider rejected the request as malformed.' }
  }
  return { kind: 'unknown', message: `Unexpected status ${status}.` }
}

interface OpenAiToolCallDelta {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}

/** Per-stream SSE framing for the OpenAI-compatible `chat/completions` wire format. */
function makeOpenAiChunkHandler(): (chunk: string) => ChunkResult {
  let residual = ''
  // Tool calls stream as fragments across chunks, keyed by index; assembled
  // here and emitted as complete tool_call events when the stream finishes.
  const toolAcc = new Map<number, { id: string; name: string; args: string }>()

  const flushTools = (): StreamEvent[] =>
    [...toolAcc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, t]) => ({ type: 'tool_call' as const, id: t.id, name: t.name, arguments: t.args }))

  return (chunk) => {
    const parsed = parseSse(chunk, residual)
    residual = parsed.residual

    const events: StreamEvent[] = []
    for (const record of parsed.events) {
      if (record.data === '[DONE]') return { events: [...events, ...flushTools()], complete: true }
      let payload: {
        choices?: { delta?: { content?: string; reasoning_content?: string; tool_calls?: OpenAiToolCallDelta[] }; finish_reason?: string }[]
      }
      try {
        payload = JSON.parse(record.data) as typeof payload
      } catch {
        continue
      }
      const choice = payload.choices?.[0]
      const delta = choice?.delta
      if (delta?.reasoning_content) events.push({ type: 'reasoning', delta: delta.reasoning_content })
      if (delta?.content) events.push({ type: 'text', delta: delta.content })
      for (const tc of delta?.tool_calls ?? []) {
        const idx = tc.index ?? 0
        const cur = toolAcc.get(idx) ?? { id: '', name: '', args: '' }
        if (tc.id) cur.id = tc.id
        if (tc.function?.name) cur.name = tc.function.name
        if (tc.function?.arguments) cur.args += tc.function.arguments
        toolAcc.set(idx, cur)
      }
      if (choice?.finish_reason === 'tool_calls') return { events: [...events, ...flushTools()], complete: true }
    }
    return { events }
  }
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
      let body: { data?: { id?: string }[] }
      try {
        body = (await response.json()) as { data?: { id?: string }[] }
      } catch {
        return []
      }
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
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
            ...(request.tools && request.tools.length > 0
              ? { tools: request.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) }
              : {}),
            messages: toOpenAiMessages(request.messages),
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

      yield* consumeStream(response.body, signal, makeOpenAiChunkHandler())
    },
  }
}
