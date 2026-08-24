import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectStore } from '../../src/main/projects/store.js'

let store: ProjectStore
let file: string

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oc-projects-'))
  file = join(dir, 'projects.json')
  store = new ProjectStore(file)
})

describe('ProjectStore', () => {
  it('starts empty with no active project', async () => {
    expect(await store.list()).toEqual({ projects: [], activeId: null })
  })

  it('names a new project after its folder by default', async () => {
    const p = await store.create('/home/me/modelith')
    expect(p.name).toBe('modelith')
    expect(p.root).toBe('/home/me/modelith')
  })

  it('accepts an explicit name', async () => {
    const p = await store.create('/home/me/modelith', 'Work copy')
    expect(p.name).toBe('Work copy')
  })

  it('makes the first project active', async () => {
    const p = await store.create('/a')
    expect((await store.list()).activeId).toBe(p.id)
  })

  it('reuses the existing project when the same folder is picked again', async () => {
    const first = await store.create('/a')
    const again = await store.create('/a')
    expect(again.id).toBe(first.id)
    expect((await store.list()).projects).toHaveLength(1)
  })

  it('renames the display name without touching the root', async () => {
    const p = await store.create('/a', 'One')
    await store.rename(p.id, 'Two')
    const [stored] = (await store.list()).projects
    expect(stored?.name).toBe('Two')
    expect(stored?.root).toBe('/a')
  })

  it('removes a project and clears active when it was the active one', async () => {
    const p = await store.create('/a')
    await store.remove(p.id)
    expect(await store.list()).toEqual({ projects: [], activeId: null })
  })

  it('orders projects most recently opened first', async () => {
    const a = await store.create('/a')
    const b = await store.create('/b')
    await store.setActive(a.id)
    const ids = (await store.list()).projects.map((p) => p.id)
    expect(ids).toEqual([a.id, b.id])
  })

  it('resolves a root by project id', async () => {
    const p = await store.create('/a')
    expect(await store.rootOf(p.id)).toBe('/a')
  })

  it('resolves NO root for an unknown project id, never another project', async () => {
    await store.create('/a')
    // This is the state a non-destructive remove deliberately leaves behind.
    expect(await store.rootOf('gone')).toBeNull()
  })

  it('resolves NO root when the session has no project', async () => {
    await store.create('/a')
    expect(await store.rootOf(undefined)).toBeNull()
  })

  it('does not lose a concurrent write', async () => {
    await Promise.all([store.create('/a'), store.create('/b')])
    expect((await store.list()).projects).toHaveLength(2)
  })

  it('fails loudly on a corrupt file rather than discarding the list', async () => {
    await writeFile(file, '{ not valid json', 'utf8')
    // Unlike preferences, this is user data whose silent loss is confusing.
    await expect(store.list()).rejects.toThrow(/corrupt/i)
  })

  it('treats a file of the wrong shape as corrupt, not as a crash', async () => {
    // Parses cleanly, but carries no project list — a hand-edit, a half-synced
    // cloud copy, a file from another version. Without a shape check this
    // reaches sort() and throws "undefined is not iterable", so the one file
    // the design says must fail loudly and legibly fails obscurely instead.
    await writeFile(file, '{}', 'utf8')
    await expect(store.list()).rejects.toThrow(/corrupt/i)
  })

  it('treats a non-object file as corrupt', async () => {
    await writeFile(file, 'null', 'utf8')
    await expect(store.list()).rejects.toThrow(/corrupt/i)
  })
})
