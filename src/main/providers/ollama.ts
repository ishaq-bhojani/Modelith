import { statusToError } from './openai-compat.js'
import { consumeStream, type ChunkResult } from './stream-consumer.js'
import type { ChatRequest, Provider, ProviderConfig } from './types.js'
import type { ModelInfo, StreamEvent } from '../../shared/types.js'

const DEFAULT_BASE_URL = 'http://localhost:11434'

/**
 * Per-stream newline-delimited-JSON framing for Ollama's `/api/chat` wire
 * format. Unlike every other provider in this codebase, Ollama does not use
 * SSE at all — each line is a standalone JSON object, and the terminal
 * record is signalled by `done: true` rather than a sentinel event type.
 */
function makeOllamaChunkHandler(): (chunk: string) => ChunkResult {
  let residual = ''
  return (chunk) => {
    residual += chunk
    const lines = residual.split('\n')
    residual = lines.pop() ?? ''

    const events: StreamEvent[] = []
    for (const raw of lines) {
      if (raw.trim() === '') continue
      let payload: { message?: { content?: string }; done?: boolean }
      try {
        payload = JSON.parse(raw) as typeof payload
      } catch {
        continue
      }
      if (payload.message?.content) events.push({ type: 'text', delta: payload.message.content })
      if (payload.done === true) return { events, complete: true }
    }
    return { events }
  }
}

export function createOllamaProvider(): Provider {
  const urlFor = (config: ProviderConfig, path: string) =>
    `${(config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')}${path}`

  return {
    id: 'ollama',
    label: 'Ollama (local)',
    defaultBaseUrl: DEFAULT_BASE_URL,
    // Ollama is a local runtime; it needs no credential to talk to.
    requiresKey: false,

    async listModels(config) {
      const response = await config.fetch(urlFor(config, '/api/tags'), {})
      if (!response.ok) return []
      let body: { models?: { name?: string }[] }
      try {
        body = (await response.json()) as { models?: { name?: string }[] }
      } catch {
        return []
      }
      return (body.models ?? [])
        .filter((m): m is { name: string } => typeof m.name === 'string')
        .map((m): ModelInfo => ({ id: m.name, label: m.name, contextWindow: 32_000 }))
    },

    async *streamChat(request: ChatRequest, signal: AbortSignal) {
      const { config } = request
      let response: Response
      try {
        response = await config.fetch(urlFor(config, '/api/chat'), {
          method: 'POST',
          signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: request.model,
            stream: true,
            // Ollama takes sampling params under `options`.
            ...(request.temperature !== undefined ? { options: { temperature: request.temperature } } : {}),
            messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          }),
        })
      } catch {
        if (signal.aborted) {
          yield { type: 'done' } satisfies StreamEvent
          return
        }
        // The overwhelmingly common cause of a transport failure here is that
        // the local Ollama server simply isn't running, so say so plainly.
        yield {
          type: 'error',
          error: { kind: 'network', message: 'Could not reach Ollama. Is it running?' },
        }
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
        yield { type: 'error', error: { kind: 'network', message: 'Ollama returned an empty body.' } }
        return
      }

      yield* consumeStream(response.body, signal, makeOllamaChunkHandler())
    },
  }
}
