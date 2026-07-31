import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StreamEngine } from '../../src/main/chat/stream-engine.js'
import { SessionStore } from '../../src/main/sessions/store.js'
import { Workspace } from '../../src/main/workspace/service.js'
import type { Provider } from '../../src/main/providers/types.js'
import type { StreamEnvelope } from '../../src/shared/types.js'
import type { AppSettingsStore } from '../../src/main/settings/store.js'

function fakeSettings(root: string): AppSettingsStore {
  return { get: async () => ({ workspaceRoot: root }), set: async () => {} } as unknown as AppSettingsStore
}

// Emits TWO write_file calls in one turn, then finishes once results return.
function twoWriteProvider(): Provider {
  return {
    id: 'fake', label: 'Fake', defaultBaseUrl: 'http://localhost', requiresKey: false,
    listModels: async () => [],
    async *streamChat(req) {
      const last = req.messages[req.messages.length - 1]
      if (last?.role === 'tool') { yield { type: 'done' }; return }
      yield { type: 'tool_call', id: 'w1', name: 'write_file', arguments: JSON.stringify({ path: 'one.txt', content: 'one\n' }) }
      yield { type: 'tool_call', id: 'w2', name: 'write_file', arguments: JSON.stringify({ path: 'two.txt', content: 'two\n' }) }
      yield { type: 'done' }
    },
  }
}

async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  for (;;) {
    if (await pred()) return
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timeout')
    await new Promise((r) => setTimeout(r, 5))
  }
}

let store: SessionStore
let root: string
let emitted: StreamEnvelope[]

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oc-trust-'))
  store = new SessionStore(dir)
  root = await mkdtemp(join(tmpdir(), 'oc-trust-root-'))
  emitted = []
})

function build(): StreamEngine {
  return new StreamEngine({
    emit: (e) => { emitted.push(e) },
    readKey: async () => 'k',
    store,
    resolveProvider: () => twoWriteProvider(),
    workspace: new Workspace(fakeSettings(root), () => undefined),
  } as ConstructorParameters<typeof StreamEngine>[0])
}

describe('trust-for-this-turn', () => {
  it('applies the rest of the turn after one trusting accept, emitting only one gate', async () => {
    const s = await store.create('t')
    const engine = build()
    await engine.start({ sessionId: s.id, providerId: 'fake', model: 'm', content: 'go', agent: true })

    // First pending gate arrives.
    await waitFor(() => emitted.some((e) => e.event.type === 'tool_pending'))
    const firstPending = emitted.find((e) => e.event.type === 'tool_pending')!
    const callId = (firstPending.event as { callId: string }).callId

    // Accept WITH trust.
    engine.resolveApproval(callId, { action: 'accept' }, true)

    // The turn finishes; both files were written.
    await waitFor(() => emitted.some((e) => e.event.type === 'done'))
    expect((await readFile(join(root, 'one.txt'), 'utf8'))).toBe('one\n')
    expect((await readFile(join(root, 'two.txt'), 'utf8'))).toBe('two\n')

    // Exactly ONE gate was ever shown.
    expect(emitted.filter((e) => e.event.type === 'tool_pending').length).toBe(1)
  })

  it('does not carry trust into a second turn (gate returns)', async () => {
    const s = await store.create('t')
    const engine = build()
    await engine.start({ sessionId: s.id, providerId: 'fake', model: 'm', content: 'go', agent: true })
    await waitFor(() => emitted.some((e) => e.event.type === 'tool_pending'))
    engine.resolveApproval((emitted.find((e) => e.event.type === 'tool_pending')!.event as { callId: string }).callId, { action: 'accept' }, true)
    await waitFor(() => emitted.some((e) => e.event.type === 'done'))

    emitted = []
    await engine.start({ sessionId: s.id, providerId: 'fake', model: 'm', content: 'go again', agent: true })
    await waitFor(() => emitted.some((e) => e.event.type === 'tool_pending'))
    expect(emitted.some((e) => e.event.type === 'tool_pending')).toBe(true)
  })
})
