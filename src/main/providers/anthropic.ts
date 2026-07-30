import { parseSse } from '../chat/sse-parser.js'
import { statusToError } from './openai-compat.js'
import { toAnthropicMessages } from './message-mapping.js'
import { consumeStream, type ChunkResult } from './stream-consumer.js'
import type { ChatRequest, Provider, ProviderConfig } from './types.js'
import type { ModelInfo, StreamEvent } from '../../shared/types.js'

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1'

/** Per-stream SSE framing for Anthropic's `messages` streaming wire format. */
function makeAnthropicChunkHandler(): (chunk: string) => ChunkResult {
  let residual = ''
  // tool_use blocks: opened by content_block_start, their JSON input streamed
  // via input_json_delta, keyed by the event's block index.
  const toolAcc = new Map<number, { id: string; name: string; args: string }>()
  const flushTools = (): StreamEvent[] =>
    [...toolAcc.entries()].sort((a, b) => a[0] - b[0])
      .map(([, t]) => ({ type: 'tool_call' as const, id: t.id, name: t.name, arguments: t.args }))

  return (chunk) => {
    const parsed = parseSse(chunk, residual)
    residual = parsed.residual

    const events: StreamEvent[] = []
    for (const record of parsed.events) {
      let payload: {
        type?: string
        index?: number
        content_block?: { type?: string; id?: string; name?: string }
        delta?: { type?: string; text?: string; thinking?: string; partial_json?: string }
      }
      try {
        payload = JSON.parse(record.data) as typeof payload
      } catch {
        continue
      }

      if (payload.type === 'error') {
        events.push({ type: 'error', error: { kind: 'unknown', message: 'The provider reported an error.' } })
        return { events, stop: true }
      }
      if (payload.type === 'message_stop') return { events: [...events, ...flushTools()], complete: true }
      if (payload.type === 'content_block_start' && payload.content_block?.type === 'tool_use') {
        toolAcc.set(payload.index ?? 0, { id: payload.content_block.id ?? '', name: payload.content_block.name ?? '', args: '' })
      }
      if (payload.delta?.type === 'input_json_delta' && payload.delta.partial_json !== undefined) {
        const cur = toolAcc.get(payload.index ?? 0)
        if (cur) cur.args += payload.delta.partial_json
      }
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
      const turns = toAnthropicMessages(request.messages.filter((m) => m.role !== 'system'))

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
            ...(request.tools && request.tools.length > 0
              ? { tools: request.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) }
              : {}),
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
