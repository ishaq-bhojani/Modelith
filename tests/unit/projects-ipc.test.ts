import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppSettingsStore } from '../../src/main/settings/store.js'
import { ProjectStore } from '../../src/main/projects/store.js'
import { migrateWorkspaceRoot } from '../../src/main/projects/migrate.js'

let settings: AppSettingsStore
let projects: ProjectStore

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oc-migrate-'))
  settings = new AppSettingsStore(join(dir, 'settings.json'))
  projects = new ProjectStore(join(dir, 'projects.json'))
})

describe('workspaceRoot migration', () => {
  it('turns an existing workspaceRoot into an active project', async () => {
    await settings.set({ workspaceRoot: '/home/me/thing' })
    await migrateWorkspaceRoot(settings, projects)
    const { projects: list, activeId } = await projects.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.root).toBe('/home/me/thing')
    expect(activeId).toBe(list[0]?.id)
  })

  it('does nothing when there is no workspaceRoot', async () => {
    await migrateWorkspaceRoot(settings, projects)
    expect((await projects.list()).projects).toHaveLength(0)
  })

  it('does not duplicate a project that already has that root', async () => {
    await settings.set({ workspaceRoot: '/a' })
    await projects.create('/a')
    await migrateWorkspaceRoot(settings, projects)
    expect((await projects.list()).projects).toHaveLength(1)
  })

  it('files no sessions — it creates a project, nothing more', async () => {
    // The spec is explicit: guessing which old chats belonged to this folder
    // is exactly what the Unfiled group exists to avoid.
    await settings.set({ workspaceRoot: '/a' })
    await migrateWorkspaceRoot(settings, projects)
    expect((await projects.list()).projects[0]?.root).toBe('/a')
  })

  it('resolves rather than rejects when projects.json is corrupt, and leaves it untouched', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oc-migrate-corrupt-'))
    const projectsPath = join(dir, 'projects.json')
    const corruptContents = '{ this is not valid json'
    await writeFile(projectsPath, corruptContents)
    const corruptSettings = new AppSettingsStore(join(dir, 'settings.json'))
    const corruptProjects = new ProjectStore(projectsPath)
    await corruptSettings.set({ workspaceRoot: '/a' })

    await expect(migrateWorkspaceRoot(corruptSettings, corruptProjects)).resolves.toBeUndefined()

    // The catch must not quietly undo "fail loudly": the corrupt file must
    // still be there, unmodified, for projects:list to surface next time.
    expect(await readFile(projectsPath, 'utf8')).toBe(corruptContents)
  })
})
