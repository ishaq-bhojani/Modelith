import { describe, it, expect } from 'vitest'
import { consumeStream, type ChunkResult } from '../../src/main/providers/stream-consumer.js'
import type { StreamEvent } from '../../src/shared/types.js'

async function collect(it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

/** A body that emits each chunk in `chunks` on every `pull`, then closes. */
function bodyFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(chunks[i]))
      i += 1
    },
  })
}

/**
 * A body whose `pull` never resolves until `signal` aborts, at which point it
 * rejects — reproducing a real mid-read abort race rather than an abort
 * observed only before the read begins.
 */
function hangingBody(signal: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull() {
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    },
  })
}

/** A body whose `pull` always rejects, regardless of the signal. */
function alwaysRejectingBody(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull() {
      return Promise.reject(new Error('stream broke'))
    },
  })
}

describe('consumeStream', () => {
  it('yields events then a single terminal done when onChunk signals complete', async () => {
    const onChunk = (): ChunkResult => ({ events: [{ type: 'text', delta: 'hi' }], complete: true })
    const events = await collect(consumeStream(bodyFrom(['chunk']), new AbortController().signal, onChunk))
    expect(events).toEqual([{ type: 'text', delta: 'hi' }, { type: 'done' }])
  })

  it('appends a single trailing done when the stream closes without an explicit completion signal', async () => {
    const onChunk = (): ChunkResult => ({ events: [{ type: 'text', delta: 'partial' }] })
    const events = await collect(consumeStream(bodyFrom(['a', 'b']), new AbortController().signal, onChunk))
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1)
    expect(events.at(-1)?.type).toBe('done')
    // Both chunks were processed (no early return), each contributing one text event.
    expect(events.filter((e) => e.type === 'text')).toHaveLength(2)
  })

  it('stops without a trailing done when onChunk signals stop (e.g. a mid-stream error)', async () => {
    const onChunk = (): ChunkResult => ({
      events: [{ type: 'error', error: { kind: 'unknown', message: 'boom' } }],
      stop: true,
    })
    const events = await collect(consumeStream(bodyFrom(['chunk']), new AbortController().signal, onChunk))
    expect(events).toEqual([{ type: 'error', error: { kind: 'unknown', message: 'boom' } }])
  })

  it('ends in exactly one terminal done, without throwing, when aborted mid-read', async () => {
    const controller = new AbortController()
    const onChunk = (): ChunkResult => ({ events: [{ type: 'text', delta: 'should not appear' }] })
    setTimeout(() => controller.abort(), 5)
    const events = await collect(consumeStream(hangingBody(controller.signal), controller.signal, onChunk))
    expect(events).toEqual([{ type: 'done' }])
  })

  it('yields a network error, not a throw, when a read rejects while not aborted', async () => {
    const onChunk = (): ChunkResult => ({ events: [] })
    const events = await collect(consumeStream(alwaysRejectingBody(), new AbortController().signal, onChunk))
    expect(events).toEqual([{ type: 'error', error: { kind: 'network', message: 'The response stream ended unexpectedly.' } }])
  })
})
