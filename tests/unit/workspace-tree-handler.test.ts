import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHANNELS } from '../../src/shared/ipc.js'
import { WORKSPACE_ROOT_MISSING } from '../../src/renderer/state/store.js'

// Whole-branch review M6. The projects spec's error table promises that a
// project whose folder is gone "still lists; selecting it shows an empty tree
// with an explanatory line". Before this, `Workspace.walk` swallowed the
// readdir failure and returned [], so the renderer showed the same "No files."
// an empty folder gets and the handler's ENOENT catch was unreachable.
//
// Mirrors the vi.doMock('electron', ...) + registration-capture pattern in
// tests/unit/project-open-folder.test.ts, so this drives the real
// registerWorkspaceHandlers() against a real ProjectStore in a temp userData
// dir rather than a reimplementation of it.
type Handlers = Map<string, (...args: unknown[]) => unknown>

async function loadHandlers(userDataDir: string): Promise<{ handled: Handlers }> {
  vi.resetModules()
  const handled: Handlers = new Map()
  vi.doMock('electron', () => ({
    app: { getPath: () => userDataDir },
    ipcMain: {
      handle: (channel: string, listener: (...args: unknown[]) => unknown) => {
        handled.set(channel, listener)
      },
    },
    shell: { openPath: vi.fn() },
    dialog: { showOpenDialog: vi.fn() },
  }))
  const mod = (await import('../../src/main/ipc/handlers.js')) as unknown as {
    registerWorkspaceHandlers: (getWindow: () => undefined) => void
  }
  mod.registerWorkspaceHandlers(() => undefined)
  return { handled }
}

async function seedActiveProject(userDataDir: string, root: string): Promise<void> {
  const { ProjectStore } = (await import('../../src/main/projects/store.js')) as unknown as {
    ProjectStore: new (p: string) => { create: (root: string) => Promise<unknown> }
  }
  await new ProjectStore(join(userDataDir, 'projects.json')).create(root)
}

describe('workspace:tree for a project whose folder is gone', () => {
  it('rejects with the missing-root sentinel instead of an empty listing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oc-tree-missing-'))
    const { handled } = await loadHandlers(dir)
    await seedActiveProject(dir, join(dir, 'unmounted-drive'))

    const handler = handled.get(CHANNELS.workspaceTree)
    expect(handler).toBeTypeOf('function')
    await expect(handler!({})).rejects.toThrow(WORKSPACE_ROOT_MISSING)
  })

  it('returns an empty array for a folder that exists and is empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oc-tree-empty-'))
    const root = join(dir, 'project')
    await mkdir(root, { recursive: true })
    const { handled } = await loadHandlers(dir)
    await seedActiveProject(dir, root)

    expect(await handled.get(CHANNELS.workspaceTree)!({})).toEqual([])
  })

  it('returns the listing for a folder that has files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oc-tree-files-'))
    const root = join(dir, 'project')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'a.ts'), 'export const a = 1')
    const { handled } = await loadHandlers(dir)
    await seedActiveProject(dir, root)

    const entries = (await handled.get(CHANNELS.workspaceTree)!({})) as { relPath: string }[]
    expect(entries.map((e) => e.relPath)).toEqual(['a.ts'])
  })

  it('still returns an empty array when no project is open at all', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oc-tree-none-'))
    const { handled } = await loadHandlers(dir)

    expect(await handled.get(CHANNELS.workspaceTree)!({})).toEqual([])
  })
})
