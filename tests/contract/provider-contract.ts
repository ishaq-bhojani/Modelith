import { describe, it, expect } from 'vitest'
import type { Provider, FetchLike } from '../../src/main/providers/types.js'
import type { StreamEvent } from '../../src/shared/types.js'

export interface ContractFixtures {
  /** A complete SSE body that yields the text "Hello world". */
  helloStream: string
  /** A 401 JSON error body. */
  authErrorBody: string
  /** A 429 JSON error body. */
  rateLimitBody: string
  /** A well-formed models-list response body. */
  modelsBody: string
  /**
   * Content-type of a successful streaming response. Defaults to SSE.
   * Providers with a different wire format (e.g. newline-delimited JSON)
   * must set this so the suite does not assume SSE framing.
   */
  contentType?: string
}

function bodyFrom(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      // Deliberately split mid-record to exercise chunk joining.
      for (let i = 0; i < text.length; i += 7) {
        controller.enqueue(encoder.encode(text.slice(i, i + 7)))
      }
      controller.close()
    },
  })
}

/**
 * A body stream whose `pull` only resolves after a short delay, and rejects
 * with an AbortError if `signal` fires while a pull is pending. Used to
 * reproduce a real mid-read abort race, as opposed to aborting before the
 * stream starts.
 */
function abortableBody(text: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let cursor = 0
  // Set by `cancel()` (called by the provider once it stops reading) so an
  // in-flight pull's timer does not touch the controller after it's closed.
  let cancelled = false
  return new ReadableStream({
    pull(controller) {
      return new Promise<void>((resolve, reject) => {
        if (signal.aborted || cancelled) {
          reject(new DOMException('Aborted', 'AbortError'))
          return
        }
        let timer: ReturnType<typeof setTimeout>
        const onAbort = () => {
          // Prevent the stale timer below from touching the controller after
          // this pull has already rejected and errored the stream.
          clearTimeout(timer)
          reject(new DOMException('Aborted', 'AbortError'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort)
          if (cancelled) {
            resolve()
            return
          }
          if (cursor >= text.length) {
            controller.close()
            resolve()
            return
          }
          controller.enqueue(encoder.encode(text.slice(cursor, cursor + 7)))
          cursor += 7
          resolve()
        }, 5)
      })
    },
    cancel() {
      cancelled = true
    },
  })
}

function stubFetch(status: number, body: string, contentType?: string): FetchLike {
  return () =>
    Promise.resolve(
      new Response(status === 200 ? bodyFrom(body) : body, {
        status,
        headers: { 'content-type': status === 200 ? (contentType ?? 'text/event-stream') : 'application/json' },
      }),
    )
}

async function collect(it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

/** Every provider must pass this suite. */
export function runProviderContract(
  name: string,
  make: () => Provider,
  fx: ContractFixtures,
): void {
  describe(`${name} provider contract`, () => {
    // Distinctive enough that an accidental echo is unambiguous.
    const SECRET = 'sk-CONTRACT-CANARY-9f3a'
    const base = (fetch: FetchLike) => ({
      model: 'test-model',
      messages: [{ id: '1', role: 'user' as const, content: 'hi', createdAt: 0 }],
      config: { apiKey: SECRET, fetch },
    })

    it('has a stable identity', () => {
      const p = make()
      expect(p.id).toMatch(/^[a-z0-9-]+$/)
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.defaultBaseUrl.startsWith('http')).toBe(true)
      expect(typeof p.requiresKey).toBe('boolean')
    })

    it('streams text deltas then exactly one done', async () => {
      const events = await collect(
        make().streamChat(
          base(stubFetch(200, fx.helloStream, fx.contentType)),
          new AbortController().signal,
        ),
      )
      const text = events.filter((e) => e.type === 'text').map((e) => e.delta).join('')
      expect(text).toBe('Hello world')
      expect(events.filter((e) => e.type === 'done')).toHaveLength(1)
      expect(events.at(-1)?.type).toBe('done')
    })

    it('emits no event after done', async () => {
      const events = await collect(
        make().streamChat(
          base(stubFetch(200, fx.helloStream, fx.contentType)),
          new AbortController().signal,
        ),
      )
      expect(events.findIndex((e) => e.type === 'done')).toBe(events.length - 1)
    })

    it('maps 401 to an auth error and never throws', async () => {
      const events = await collect(
        make().streamChat(base(stubFetch(401, fx.authErrorBody)), new AbortController().signal),
      )
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ type: 'error', error: { kind: 'auth' } })
    })

    it('maps 429 to a rate_limit error', async () => {
      const events = await collect(
        make().streamChat(base(stubFetch(429, fx.rateLimitBody)), new AbortController().signal),
      )
      expect(events[0]).toMatchObject({ type: 'error', error: { kind: 'rate_limit' } })
    })

    it('maps 503 to provider_5xx', async () => {
      const events = await collect(
        make().streamChat(base(stubFetch(503, '{}')), new AbortController().signal),
      )
      expect(events[0]).toMatchObject({ type: 'error', error: { kind: 'provider_5xx' } })
    })

    it('maps a transport failure to a network error', async () => {
      const failing: FetchLike = () => Promise.reject(new Error('ECONNREFUSED'))
      const events = await collect(
        make().streamChat(base(failing), new AbortController().signal),
      )
      expect(events[0]).toMatchObject({ type: 'error', error: { kind: 'network' } })
    })

    it('ends promptly when the signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()
      const events = await collect(
        make().streamChat(base(stubFetch(200, fx.helloStream, fx.contentType)), controller.signal),
      )
      expect(events.every((e) => e.type !== 'text')).toBe(true)
    })

    it('aborts mid-stream without throwing, ending in exactly one terminal done', async () => {
      const controller = new AbortController()
      const fetchStub: FetchLike = (_url, init) => {
        const signal = (init.signal ?? controller.signal) as AbortSignal
        return Promise.resolve(
          new Response(abortableBody(fx.helloStream, signal), {
            status: 200,
            headers: { 'content-type': fx.contentType ?? 'text/event-stream' },
          }),
        )
      }
      // Fires while a `reader.read()` is very likely in-flight (each chunk
      // resolves ~5ms apart), reproducing the race rather than aborting
      // before the stream starts.
      setTimeout(() => controller.abort(), 12)
      const events = await collect(make().streamChat(base(fetchStub), controller.signal))
      expect(events.filter((e) => e.type === 'done')).toHaveLength(1)
      expect(events.at(-1)?.type).toBe('done')
    })

    it('never leaks the api key into an error message', async () => {
      for (const status of [401, 429, 503]) {
        const events = await collect(
          make().streamChat(base(stubFetch(status, fx.authErrorBody)), new AbortController().signal),
        )
        for (const e of events) {
          if (e.type === 'error') expect(e.error.message).not.toContain(SECRET)
        }
      }
    })

    it('never passes a provider-supplied secret through into an error message', async () => {
      const leakyBody = JSON.stringify({ error: { message: `bad key ${SECRET}` } })
      const events = await collect(
        make().streamChat(base(stubFetch(401, leakyBody)), new AbortController().signal),
      )
      for (const e of events) {
        if (e.type === 'error') expect(e.error.message).not.toContain(SECRET)
      }
    })

    it('lists models from a well-formed response', async () => {
      const models = await make().listModels({ apiKey: SECRET, fetch: stubFetch(200, fx.modelsBody) })
      expect(models.length).toBeGreaterThan(0)
      expect(models[0]?.id.length).toBeGreaterThan(0)
    })

    it('returns no models rather than throwing on a malformed body', async () => {
      const models = await make().listModels({ apiKey: SECRET, fetch: stubFetch(200, 'not json{') })
      expect(models).toEqual([])
    })

    it('returns no models on a non-ok response', async () => {
      const models = await make().listModels({ apiKey: SECRET, fetch: stubFetch(404, '{}') })
      expect(models).toEqual([])
    })
  })
}
