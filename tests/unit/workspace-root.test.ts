import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Workspace } from '../../src/main/workspace/service.js'
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
  workspace = new Workspace(() => undefined, undefined, projects)
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

/**
 * Run one agent turn against a fresh session and return what `list_dir` saw.
 * `setUp` puts the session into the state under test (filed, unfiled, carrying
 * history) before the turn starts.
 */
async function listDirResultFor(
  setUp?: (sessions: SessionStore, sessionId: string) => Promise<void>,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'oc-turnroot-'))
  const sessions = new SessionStore(dir)
  const session = await sessions.create('t')
  await setUp?.(sessions, session.id)
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
  /** A conversation that already happened, so the session is not a new chat. */
  async function withHistory(sessions: SessionStore, id: string): Promise<void> {
    await sessions.append(id, { id: 'm1', role: 'user', content: 'about A', createdAt: 1 })
    await sessions.append(id, { id: 'm2', role: 'assistant', content: 'sure', createdAt: 2 })
  }

  it("confines the turn to the session's project, not the active one", async () => {
    const a = await projects.create(rootA)
    await projects.create(rootB) // B is now ACTIVE, but the session belongs to A
    expect(await listDirResultFor((s, id) => s.setProject(id, a.id))).toContain('only-in-a.txt')
  })

  it('never adopts a session that removing its project unfiled', async () => {
    const a = await projects.create(rootA)
    await projects.create(rootB) // B is now ACTIVE
    const result = await listDirResultFor(async (s, id) => {
      await s.setProject(id, a.id)
      await withHistory(s, id)
      // How the app actually removes a project (handlers: clearProject, then
      // remove). "Close this project" is non-destructive, so its conversations
      // are kept and unfiled — and clearProject DELETES projectId, so being
      // unfiled cannot by itself mean "a brand-new chat".
      await s.clearProject(a.id)
      await projects.remove(a.id)
    })
    // A long conversation about project A must not start editing project B.
    expect(result).toBe('No workspace folder is open.')
    expect(result).not.toContain('only-in-b.txt')
  })

  it('never adopts a pre-existing unfiled chat', async () => {
    await projects.create(rootA)
    // The spec is explicit that Unfiled exists so the app does not guess which
    // project a months-old chat belonged to.
    expect(await listDirResultFor(withHistory)).toBe('No workspace folder is open.')
  })

  it('reports no workspace for a new chat when no project exists', async () => {
    expect(await listDirResultFor()).toBe('No workspace folder is open.')
  })

  // I4 (design owner's ruling): turn-start adoption is GONE from the engine.
  // `resolveTurnRoot` is a pure read — session → projectId → root — so every
  // `projectId` write originates from an explicit user action in the renderer
  // rather than a side effect of sending. The old `history.length > 1` gate
  // could not see a genuinely fresh chat the user had deliberately moved to
  // Unfiled (New chat → Move to project → None → send re-filed it silently),
  // and it put a session-index WRITE inside the streaming engine, which is
  // where the whole confinement argument lives.
  //
  // The start-a-chat-then-open-a-folder flow is preserved by the renderer
  // stamping an unfiled, history-free session when a project becomes active
  // (see tests/unit/renderer-store.test.ts, "stamping the open chat").
  it('does not file an unfiled chat into the active project, even on its first turn', async () => {
    await projects.create(rootA)
    expect(await listDirResultFor()).toBe('No workspace folder is open.')
  })

  it('writes nothing to the session index while resolving a root', async () => {
    await projects.create(rootA)
    const dir = await mkdtemp(join(tmpdir(), 'oc-turnroot-nowrite-'))
    const sessions = new SessionStore(dir)
    const session = await sessions.create('t')
    const setProject = vi.spyOn(sessions, 'setProject')
    const engine = new StreamEngine({
      emit: () => {}, readKey: async () => 'k', store: sessions,
      resolveProvider: () => listDirProvider(), workspace, projects,
    })
    await engine.start({ sessionId: session.id, providerId: 'fake', model: 'm', content: 'go', agent: true })
    for (let i = 0; i < 600; i++) {
      if ((await sessions.load(session.id)).some((m) => m.role === 'tool')) break
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(setProject).not.toHaveBeenCalled()
    expect((await sessions.list()).find((s) => s.id === session.id)?.projectId).toBeUndefined()
  })
})
