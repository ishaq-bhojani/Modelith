import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StreamEngine } from '../../src/main/chat/stream-engine.js'
import { SessionStore } from '../../src/main/sessions/store.js'
import { Workspace } from '../../src/main/workspace/service.js'
import { ProjectStore } from '../../src/main/projects/store.js'
import type { Provider } from '../../src/main/providers/types.js'
import type { AppSettingsStore } from '../../src/main/settings/store.js'

function fakeSettings(root: string): AppSettingsStore {
  return { get: async () => ({ workspaceRoot: root }), set: async () => {} } as unknown as AppSettingsStore
}

let store: SessionStore
let projects: ProjectStore
let projectId: string
let root: string

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oc-hint-'))
  store = new SessionStore(dir)
  root = await mkdtemp(join(tmpdir(), 'oc-hint-root-'))
  projects = new ProjectStore(join(dir, 'projects.json'))
  projectId = (await projects.create(root)).id
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
    workspace: new Workspace(fakeSettings(root), () => undefined, undefined, projects),
    projects,
  } as ConstructorParameters<typeof StreamEngine>[0])
  const s = await store.create('t')
  // The hint only appears when the turn resolves a root — which comes from the
  // session's project, so file it first.
  await store.setProject(s.id, projectId)
  await engine.start({ sessionId: s.id, providerId: 'fake', model: 'm', content: 'hi', systemPrompt: 'Base.', agent: true })
  await waitFor(() => seenSystem !== '')
  expect(seenSystem).toContain('Base.')
  expect(seenSystem).toContain('search_files')
})
