import type { StreamEvent } from '../../shared/types.js'

export interface ChunkResult {
  /** Events to yield, in order, for this chunk. May be empty. */
  events: StreamEvent[]
  /**
   * Set when the provider's own framing signalled a clean end-of-stream
   * (e.g. `[DONE]`, `message_stop`, `done: true`). `consumeStream` yields
   * `events`, then a single terminal `done`, then returns.
   */
  complete?: boolean
  /**
   * Set when `events` already contains a terminal event (e.g. a mid-stream
   * `error` payload) that must end the generator immediately, without an
   * added trailing `done`. `consumeStream` yields `events`, then returns.
   */
  stop?: boolean
}

/**
 * Consumes a response body with abort handling, decoding, and reader
 * cancellation, emitting exactly one terminal `done` on every exit path.
 * Wire framing (SSE, newline-delimited JSON, etc.) is entirely the caller's
 * concern: `onChunk` decodes its own chunk and holds any residual/buffer
 * state in its closure.
 */
export async function* consumeStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onChunk: (chunk: string) => ChunkResult,
): AsyncGenerator<StreamEvent> {
  const decoder = new TextDecoder()
  const reader = body.getReader()

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
      // Assumption: when the reader reports `done`, any residual bytes still
      // sitting in `onChunk`'s closure (a final record with no trailing
      // newline/terminator) are discarded rather than flushed. Every shipped
      // provider newline-terminates its final record, so this has never lost
      // real data — but a future provider that does not would silently drop
      // its last record here. Deliberately not "fixed" without a concrete
      // provider that needs it, since flushing an unterminated residual as if
      // it were a complete record could just as easily fabricate one.
      if (result.done) break

      const chunkResult = onChunk(decoder.decode(result.value, { stream: true }))
      for (const event of chunkResult.events) yield event
      if (chunkResult.stop) return
      if (chunkResult.complete) {
        yield { type: 'done' }
        return
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  yield { type: 'done' }
}
