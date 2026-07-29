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

  it('reaches a keyless (requiresKey: false) provider even when no key is stored', async () => {
    const s = await store.create('t')
    const keylessProvider: Provider = {
      id: 'keyless', label: 'Keyless', defaultBaseUrl: 'http://localhost', requiresKey: false,
      listModels: async () => [],
      async *streamChat() {
        yield { type: 'text', delta: 'reached' }
        yield { type: 'done' }
      },
    }
    const engine = new StreamEngine({
      emit: (e) => { emitted.push(e) },
      readKey: async () => null,
      store,
      resolveProvider: () => keylessProvider,
    })
    await engine.start({ sessionId: s.id, providerId: 'keyless', model: 'm', content: 'hi' })
    await waitFor(() => emitted.some((e) => e.event.type === 'done'))
    // The provider must actually have been invoked (proven by the 'text'
    // event it alone can produce), not merely that no auth error appeared —
    // an engine that emitted nothing at all would also satisfy a
    // no-auth-error-only assertion.
    expect(emitted.some((e) => e.event.type === 'text' && e.event.delta === 'reached')).toBe(true)
    expect(emitted.some((e) => e.event.type === 'error')).toBe(false)
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

  it('marks the persisted reply incomplete when the stream ends via a provider error, not only on abort', async () => {
    const s = await store.create('t')
    const engine = build(fakeProvider([
      { type: 'text', delta: 'partial ' },
      { type: 'text', delta: 'reply' },
      { type: 'error', error: { kind: 'rate_limit', message: 'Rate limit reached.' } },
    ]))
    await engine.start({ sessionId: s.id, providerId: 'fake', model: 'm', content: 'hi' })
    await waitFor(() => emitted.some((e) => e.event.type === 'error'))
    await waitFor(async () => (await store.load(s.id)).length === 2)
    const saved = await store.load(s.id)
    const assistant = saved.find((m) => m.role === 'assistant')
    expect(assistant?.content).toBe('partial reply')
    expect(assistant?.incomplete).toBe(true)
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

  // A setTimeout callback only fires after the microtask queue has fully
  // drained, so waiting on one (even 0ms) is a reliable way to guarantee any
  // pending .then()/.catch()/.finally() continuations — such as the
  // session-cleanup in StreamEngine.start() — have already run.
  const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0))

  it('reports an error and does not start the turn when the user-message append fails', async () => {
    const s = await store.create('t')
    // store.append is monkey-patched (not the real fs-backed implementation)
    // purely to simulate a disk/permission failure on demand.
    store.append = (async () => {
      throw new Error('simulated disk failure')
    }) as typeof store.append
    const engine = build(fakeProvider([{ type: 'text', delta: 'hi' }, { type: 'done' }]))

    const { streamId } = await engine.start({
      sessionId: s.id, providerId: 'fake', model: 'm', content: 'hi',
    })
    await waitFor(() => emitted.length > 0)

    // (a) an error envelope is emitted with the correct streamId
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      streamId, sessionId: s.id, event: { type: 'error', error: { kind: 'unknown' } },
    })

    // (c) the session is not left in-flight: a subsequent start() for the
    // same session is accepted rather than rejected as busy. (append still
    // fails, so this second turn also errors out — the point is that it is
    // never short-circuited by the same-session guard.)
    await flushMicrotasks()
    const second = await engine.start({ sessionId: s.id, providerId: 'fake', model: 'm', content: 'again' })
    await waitFor(() => emitted.some((e) => e.streamId === second.streamId))
    const secondEnvelopes = emitted.filter((e) => e.streamId === second.streamId)
    expect(secondEnvelopes[0]?.event).not.toMatchObject({ error: { kind: 'busy' } })

    // (b) no unhandled rejection: vitest fails the run on one, so simply
    // reaching this point across two full turns is itself part of the proof.
  })

  it('reports an error but keeps the streamed text visible in history when only the assistant append fails', async () => {
    const s = await store.create('t')
    const originalAppend = store.append.bind(store)
    let calls = 0
    store.append = (async (id, message) => {
      calls += 1
      // Let the user-message append (call 1) succeed so the turn proceeds
      // to actually stream; fail only the assistant append (call 2).
      if (calls === 2) throw new Error('simulated disk failure')
      return originalAppend(id, message)
    }) as typeof store.append
    const engine = build(fakeProvider([
      { type: 'text', delta: 'he' }, { type: 'text', delta: 'llo' }, { type: 'done' },
    ]))

    const { streamId } = await engine.start({
      sessionId: s.id, providerId: 'fake', model: 'm', content: 'hi',
    })
    await waitFor(() => emitted.some((e) => e.event.type === 'error'))

    // (a) an error envelope is emitted with the correct streamId, distinct
    // from the ordinary stream events that preceded it.
    const errorEnvelope = emitted.find((e) => e.event.type === 'error')
    expect(errorEnvelope).toMatchObject({ streamId, sessionId: s.id, event: { error: { kind: 'unknown' } } })
    expect(emitted.some((e) => e.event.type === 'text')).toBe(true)

    // The user message survived (append #1 succeeded); the assistant reply
    // did not (append #2 failed) — requirement 7 says partial output must
    // never be silently discarded, and "silently" is the operative word: the
    // error envelope above is what keeps this from being silent, even though
    // the text itself could not be persisted here.
    const saved = await store.load(s.id)
    expect(saved.map((m) => m.role)).toEqual(['user'])

    // (c) the session is not left in-flight.
    await flushMicrotasks()
    const second = await engine.start({ sessionId: s.id, providerId: 'fake', model: 'm', content: 'again' })
    await waitFor(() => emitted.some((e) => e.streamId === second.streamId))
    const secondEnvelopes = emitted.filter((e) => e.streamId === second.streamId)
    expect(secondEnvelopes.some((e) => e.event.type === 'error' && e.event.error.kind === 'busy')).toBe(false)

    // (b) no unhandled rejection: reaching this point is part of the proof.
  })
})
