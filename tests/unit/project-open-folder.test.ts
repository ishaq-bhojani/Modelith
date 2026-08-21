import { describe, it, expect, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHANNELS } from '../../src/shared/ipc.js'

// Fix round 1, item 4: "Open folder" on the project row menu
// (docs/superpowers/specs/2026-08-04-projects-design.md line 126: "Project →
// Rename, Open folder, Remove"). The renderer passes only a project id; main
// resolves the root and opens it — mirrors the existing
// `windowOpenChatsFolder` handler at src/main/window/controls.ts:31
// (`shell.openPath`).
//
// Mirrors the vi.doMock('electron', ...) + registration-capture pattern in
// tests/unit/updater-handlers.test.ts, so this exercises the real
// registerProjectHandlers() end-to-end (real ProjectStore against a temp
// userData dir), not a reimplementation of its logic.
type Handlers = Map<string, (...args: unknown[]) => unknown>

async function loadHandlers(userDataDir: string, openPathImpl: (p: string) => Promise<string>): Promise<{
  registerProjectHandlers: () => void
  handled: Handlers
  openPath: ReturnType<typeof vi.fn>
}> {
  vi.resetModules()
  const handled: Handlers = new Map()
  const openPath = vi.fn(openPathImpl)
  vi.doMock('electron', () => ({
    app: { getPath: () => userDataDir },
    ipcMain: {
      handle: (channel: string, listener: (...args: unknown[]) => unknown) => {
        handled.set(channel, listener)
      },
    },
    shell: { openPath },
  }))
  const mod = (await import('../../src/main/ipc/handlers.js')) as unknown as {
    registerProjectHandlers: () => void
  }
  return { ...mod, handled, openPath }
}

describe('projects:open-folder', () => {
  it('resolves the id to a root and opens it, never passing a renderer-supplied path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oc-open-folder-'))
    const { registerProjectHandlers, handled, openPath } = await loadHandlers(dir, async () => '')
    registerProjectHandlers()

    // Seed a real project the same way projects:create would.
    const { ProjectStore } = (await import('../../src/main/projects/store.js')) as unknown as {
      ProjectStore: new (p: string) => { create: (root: string) => Promise<{ id: string }> }
    }
    const store = new ProjectStore(join(dir, 'projects.json'))
    const project = await store.create('/some/real/folder')

    const handler = handled.get(CHANNELS.projectOpenFolder)
    expect(handler).toBeTypeOf('function')
    await handler!({}, { id: project.id })

    expect(openPath).toHaveBeenCalledWith('/some/real/folder')
  })

  it('is a no-op, not a throw, for an id that names no project', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oc-open-folder-unknown-'))
    const { registerProjectHandlers, handled, openPath } = await loadHandlers(dir, async () => '')
    registerProjectHandlers()

    const handler = handled.get(CHANNELS.projectOpenFolder)!
    await expect(handler({}, { id: 'does-not-exist' })).resolves.toBeUndefined()
    expect(openPath).not.toHaveBeenCalled()
  })

  it('does not surface shell.openPath rejecting as an unhandled rejection (folder gone from disk)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oc-open-folder-missing-'))
    const { registerProjectHandlers, handled } = await loadHandlers(dir, async () => { throw new Error('ENOENT') })
    registerProjectHandlers()

    const { ProjectStore } = (await import('../../src/main/projects/store.js')) as unknown as {
      ProjectStore: new (p: string) => { create: (root: string) => Promise<{ id: string }> }
    }
    const store = new ProjectStore(join(dir, 'projects.json'))
    const project = await store.create('/a/folder/deleted/since')

    const handler = handled.get(CHANNELS.projectOpenFolder)!
    // A project whose folder is gone still lists — opening it must degrade
    // quietly, not reject the IPC call.
    await expect(handler({}, { id: project.id })).resolves.toBeUndefined()
  })
})
