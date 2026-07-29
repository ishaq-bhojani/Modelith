import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StreamEngine } from '../../src/main/chat/stream-engine.js'
import { SessionStore } from '../../src/main/sessions/store.js'
import type { Provider } from '../../src/main/providers/types.js'
import type { StreamEvent, StreamEnvelope } from '../../src/shared/types.js'

function fakeProvider(events: StreamEvent[], delayMs = 0): Provider {
  return {
    id: 'fake', label: 'Fake', defaultBaseUrl: 'http://localhost', requiresKey: true,
    listModels: async () => [],
    async *streamChat(_req, signal) {
      for (const e of events) {
        if (signal.aborted) return
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
        yield e
      }
    },
  }
}

let store: SessionStore
let emitted: StreamEnvelope[]

const build = (provider: Provider) => {
  emitted = []
  return new StreamEngine({
    emit: (envelope) => { emitted.push(envelope) },
    readKey: async () => 'test-key',
    store,
    resolveProvider: () => provider,
  })
}

beforeEach(async () => {
  store = new SessionStore(await mkdtemp(join(tmpdir(), 'oc-engine-')))
  emitted = []
})

// A fixed sleep is an unreliable way to wait for an async chain (file I/O,
// microtask hops) to settle — under load it can legitimately take longer than
// any fixed guess, producing a test that fails only occasionally. Poll for
// the actual condition instead, with a generous timeout as the failure floor.
async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  for (;;) {
    if (await predicate()) return
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: condition was not met before the timeout')
    }
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('StreamEngine', () => {
  it('tags every envelope with the same streamId', async () => {
    const s = await store.create('t')
    const engine = build(fakeProvider([{ type: 'text', delta: 'hi' }, { type: 'done' }]))
    const { streamId } = await engine.start({
      sessionId: s.id, providerId: 'fake', model: 'm', content: 'hello',
    })
    await waitFor(() => emitted.some((e) => e.event.type === 'done'))
    expect(emitted.length).toBeGreaterThan(0)
    expect(emitted.every((e) => e.streamId === streamId)).toBe(true)
    expect(emitted.every((e) => e.sessionId === s.id)).toBe(true)
  })

  it('persists the user message and the assistant reply', async () => {
    const s = await store.create('t')
    const engine = build(fakeProvider([
      { type: 'text', delta: 'he' }, { type: 'text', delta: 'llo' }, { type: 'done' },
    ]))
    await engine.start({ sessionId: s.id, providerId: 'fake', model: 'm', content: 'hi' })
    await waitFor(() => emitted.some((e) => e.event.type === 'done'))
    await waitFor(async () => (await store.load(s.id)).length === 2)
    const saved = await store.load(s.id)
    expect(saved.map((m) => [m.role, m.content])).toEqual([['user', 'hi'], ['assistant', 'hello']])
  })

  it('emits an auth error when no key is configured', async () => {
    const s = await store.create('t')
    const engine = new StreamEngine({
      emit: (e) => { emitted.push(e) },
      readKey: async () => null,
      store,
      resolveProvider: () => fakeProvider([{ type: 'done' }]),
    })
    await engine.start({ sessionId: s.id, providerId: 'fake', model: 'm', content: 'hi' })
    await waitFor(() => emitted.length > 0)
    expect(emitted[0]?.event).toMatchObject({ type: 'error', error: { kind: 'auth' } })
  })

  it('stops emitting after abort and marks the reply incomplete, with no aborted error event', async () => {
    const s = await store.create('t')
    const engine = build(fakeProvider(
      Array.from({ length: 50 }, () => ({ type: 'text', delta: 'x' }) as StreamEvent), 5,
    ))
    const { streamId } = await engine.start({
      sessionId: s.id, providerId: 'fake', model: 'm', content: 'hi',
    })
    await new Promise((r) => setTimeout(r, 20))
    engine.abort(streamId)
    const countAtAbort = emitted.length
    await new Promise((r) => setTimeout(r, 300))
    expect(emitted.length).toBeLessThanOrEqual(countAtAbort + 1)
    const saved = await store.load(s.id)
    expect(saved.at(-1)?.incomplete).toBe(true)
    // Note 3: the renderer initiated the abort and already knows; the engine
    // must not additionally emit an 'aborted' (or any) error event for it.
    expect(emitted.some((e) => e.event.type === 'error')).toBe(false)
  })

  it('gives concurrent streams distinct ids', async () => {
    const a = await store.create('a')
    const b = await store.create('b')
    const engine = build(fakeProvider([{ type: 'text', delta: 'x' }, { type: 'done' }]))
    const first = await engine.start({ sessionId: a.id, providerId: 'fake', model: 'm', content: '1' })
    const second = await engine.start({ sessionId: b.id, providerId: 'fake', model: 'm', content: '2' })
    expect(first.streamId).not.toBe(second.streamId)
  })

  it('rejects a second concurrent start for the same session without interleaving appends', async () => {
    const s = await store.create('t')
    // Slow enough that the first turn is still in flight when the second start() lands.
    const engine = build(fakeProvider(
      Array.from({ length: 10 }, () => ({ type: 'text', delta: 'a' }) as StreamEvent).concat([{ type: 'done' }]),
      15,
    ))
    const first = await engine.start({ sessionId: s.id, providerId: 'fake', model: 'm', content: 'one' })
    const second = await engine.start({ sessionId: s.id, providerId: 'fake', model: 'm', content: 'two' })

    expect(second.streamId).not.toBe(first.streamId)

    // The rejected turn gets its own streamId-tagged error immediately, and only that.
    await waitFor(() => emitted.some((e) => e.streamId === second.streamId))
    const secondEnvelopes = emitted.filter((e) => e.streamId === second.streamId)
    expect(secondEnvelopes).toHaveLength(1)
    expect(secondEnvelopes[0]?.event).toMatchObject({ type: 'error', error: { kind: 'busy' } })

    // Let the first turn finish fully.
    await waitFor(() => emitted.some((e) => e.streamId === first.streamId && e.event.type === 'done'))
    await waitFor(async () => (await store.load(s.id)).length === 2)

    const saved = await store.load(s.id)
    // Only the first turn's user message was ever appended; the rejected
    // second turn's content ('two') must never reach the transcript, and
    // there must be exactly one assistant reply (no interleaving).
    expect(saved.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['one'])
    expect(saved.filter((m) => m.role === 'assistant')).toHaveLength(1)
  })
})
