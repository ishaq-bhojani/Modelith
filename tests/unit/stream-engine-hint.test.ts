import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StreamEngine } from '../../src/main/chat/stream-engine.js'
import { SessionStore } from '../../src/main/sessions/store.js'
import { Workspace } from '../../src/main/workspace/service.js'
import type { Provider } from '../../src/main/providers/types.js'
import type { AppSettingsStore } from '../../src/main/settings/store.js'

function fakeSettings(root: string): AppSettingsStore {
  return { get: async () => ({ workspaceRoot: root }), set: async () => {} } as unknown as AppSettingsStore
}

let store: SessionStore
let root: string

beforeEach(async () => {
  store = new SessionStore(await mkdtemp(join(tmpdir(), 'oc-hint-')))
  root = await mkdtemp(join(tmpdir(), 'oc-hint-root-'))
})

async function waitFor(pred: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now()
  while (!pred()) { if (Date.now() - start > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)) }
}

it('appends a discovery hint to the system prompt in agent mode', async () => {
  let seenSystem = ''
  const provider: Provider = {
    id: 'fake', label: 'Fake', defaultBaseUrl: 'http://localhost', requiresKey: false,
    listModels: async () => [],
    async *streamChat(req) {
      seenSystem = req.messages.find((m) => m.role === 'system')?.content ?? ''
      yield { type: 'done' }
    },
  }
  const engine = new StreamEngine({
    emit: () => {}, readKey: async () => 'k', store, resolveProvider: () => provider,
    workspace: new Workspace(fakeSettings(root), () => undefined),
  } as ConstructorParameters<typeof StreamEngine>[0])
  const s = await store.create('t')
  await engine.start({ sessionId: s.id, providerId: 'fake', model: 'm', content: 'hi', systemPrompt: 'Base.', agent: true })
  await waitFor(() => seenSystem !== '')
  expect(seenSystem).toContain('Base.')
  expect(seenSystem).toContain('search_files')
})
