import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Workspace } from '../../src/main/workspace/service.js'
import { AppSettingsStore } from '../../src/main/settings/store.js'
import { ProjectStore } from '../../src/main/projects/store.js'
import { SessionStore } from '../../src/main/sessions/store.js'
import { StreamEngine } from '../../src/main/chat/stream-engine.js'
import type { Provider } from '../../src/main/providers/types.js'

let rootA: string
let rootB: string
let workspace: Workspace
let projects: ProjectStore

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'oc-wsroot-'))
  rootA = join(base, 'a'); rootB = join(base, 'b')
  await mkdir(rootA); await mkdir(rootB)
  await writeFile(join(rootA, 'only-in-a.txt'), 'A', 'utf8')
  await writeFile(join(rootB, 'only-in-b.txt'), 'B', 'utf8')
  projects = new ProjectStore(join(base, 'projects.json'))
  workspace = new Workspace(
    new AppSettingsStore(join(base, 'settings.json')),
    () => undefined,
    undefined,
    projects,
  )
})

describe('Workspace roots are per-call, not global', () => {
  it('reads from the root it was given', async () => {
    expect((await workspace.read(rootA, 'only-in-a.txt')).text).toBe('A')
    expect((await workspace.read(rootB, 'only-in-b.txt')).text).toBe('B')
  })

  it('refuses a file that exists in another root', async () => {
    // The whole point: passing root A must not reach project B's files, even
    // though both are legitimate roots for this app.
    await expect(workspace.read(rootA, 'only-in-b.txt')).rejects.toThrow()
  })

  it('still refuses traversal out of the given root', async () => {
    await expect(workspace.read(rootA, '../b/only-in-b.txt')).rejects.toThrow()
  })

  it('trees the root it was given', async () => {
    const names = (await workspace.tree(rootA)).map((e) => e.relPath)
    expect(names).toContain('only-in-a.txt')
    expect(names).not.toContain('only-in-b.txt')
  })

  it('activeRoot follows the active project', async () => {
    const a = await projects.create(rootA)
    expect(await workspace.activeRoot()).toBe(rootA)
    await projects.create(rootB)
    expect(await workspace.activeRoot()).toBe(rootB)
    await projects.setActive(a.id)
    expect(await workspace.activeRoot()).toBe(rootA)
  })

  it('activeRoot is null when no project exists', async () => {
    expect(await workspace.activeRoot()).toBeNull()
  })
})

// ── The turn's root comes from the turn's own session ──────────────────────
//
// The spec's load-bearing rule: session → projectId → root, resolved once at
// turn start. These drive it through a real StreamEngine turn whose provider
// calls `list_dir`, so the assertion is on what the AGENT actually saw.

/** Calls list_dir once, then finishes when the tool result comes back. */
function listDirProvider(): Provider {
  return {
    id: 'fake', label: 'Fake', defaultBaseUrl: 'http://localhost', requiresKey: false,
    listModels: async () => [],
    async *streamChat(req) {
      const last = req.messages[req.messages.length - 1]
      if (last?.role === 'tool') { yield { type: 'done' }; return }
      yield { type: 'tool_call', id: 'c1', name: 'list_dir', arguments: '{}' }
      yield { type: 'done' }
    },
  }
}

async function listDirResultFor(projectId: string | undefined): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'oc-turnroot-'))
  const sessions = new SessionStore(dir)
  const session = await sessions.create('t')
  if (projectId !== undefined) await sessions.setProject(session.id, projectId)
  const engine = new StreamEngine({
    emit: () => {},
    readKey: async () => 'k',
    store: sessions,
    resolveProvider: () => listDirProvider(),
    workspace,
    projects,
  })
  await engine.start({ sessionId: session.id, providerId: 'fake', model: 'm', content: 'go', agent: true })
  for (let i = 0; i < 600; i++) {
    const messages = await sessions.load(session.id)
    const toolMessage = messages.find((m) => m.role === 'tool')
    if (toolMessage) return toolMessage.content
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('the tool never ran')
}

describe("a turn's root comes from its own session", () => {
  it('confines the turn to the session\'s project, not the active one', async () => {
    const a = await projects.create(rootA)
    await projects.create(rootB) // B is now ACTIVE, but the session belongs to A
    expect(await listDirResultFor(a.id)).toContain('only-in-a.txt')
  })

  it('resolves NO root for a session naming a removed project', async () => {
    const a = await projects.create(rootA)
    await projects.create(rootB)
    await projects.remove(a.id)
    // The state a non-destructive Remove deliberately leaves behind. It must
    // never borrow the surviving project's folder.
    const result = await listDirResultFor(a.id)
    expect(result).toBe('No workspace folder is open.')
    expect(result).not.toContain('only-in-b.txt')
  })

  it('reports no workspace for an unfiled session when no project exists', async () => {
    expect(await listDirResultFor(undefined)).toBe('No workspace folder is open.')
  })

  it('files an unfiled session into the active project on its first turn', async () => {
    await projects.create(rootA)
    expect(await listDirResultFor(undefined)).toContain('only-in-a.txt')
  })
})
