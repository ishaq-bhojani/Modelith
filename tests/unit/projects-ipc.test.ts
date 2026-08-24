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

  // I2: the migration is documented as "One-time" and the spec says it runs
  // "on first launch after this ships". Nothing else writes or clears
  // `settings.workspaceRoot` (the old `Workspace.pick()` writer is gone), so
  // unless the migration clears it itself it runs on EVERY launch, forever.
  it('clears workspaceRoot from settings once the project exists', async () => {
    await settings.set({ workspaceRoot: '/a' })
    await migrateWorkspaceRoot(settings, projects)
    expect((await settings.get())['workspaceRoot']).toBeUndefined()
  })

  it('does not re-activate the legacy folder on every later launch', async () => {
    await settings.set({ workspaceRoot: '/legacy' })
    await migrateWorkspaceRoot(settings, projects)
    // The user then opens a second project and works in it.
    const other = await projects.create('/other')
    // Restart.
    await migrateWorkspaceRoot(settings, projects)
    expect((await projects.list()).activeId).toBe(other.id)
  })

  it('does not resurrect a legacy project the user removed', async () => {
    await settings.set({ workspaceRoot: '/legacy' })
    await migrateWorkspaceRoot(settings, projects)
    const { projects: list } = await projects.list()
    await projects.remove(list[0]!.id)
    // Removing the only project leaves projects.json present but empty — the
    // exact case a "skip when projects.json exists" gate would fail to cover.
    expect((await projects.list()).projects).toHaveLength(0)

    await migrateWorkspaceRoot(settings, projects)

    expect((await projects.list()).projects).toHaveLength(0)
  })

  it('leaves workspaceRoot in place when the migration failed, so the next launch retries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oc-migrate-retry-'))
    const projectsPath = join(dir, 'projects.json')
    await writeFile(projectsPath, '{ this is not valid json')
    const retrySettings = new AppSettingsStore(join(dir, 'settings.json'))
    const retryProjects = new ProjectStore(projectsPath)
    await retrySettings.set({ workspaceRoot: '/a' })

    await migrateWorkspaceRoot(retrySettings, retryProjects)

    expect((await retrySettings.get())['workspaceRoot']).toBe('/a')
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
