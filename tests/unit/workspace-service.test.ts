import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Workspace, WorkspaceError } from '../../src/main/workspace/service.js'

/** An in-memory stand-in for the settings store, so no disk KV is needed here. */

let root: string
let outside: string
let ws: Workspace

beforeAll(async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'oc-ws-'))
  root = path.join(base, 'project')
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(path.join(root, 'src', 'a.txt'), 'hello world')
  await writeFile(path.join(root, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02, 0x00]))
  await writeFile(path.join(root, 'big.txt'), 'x'.repeat(300 * 1024))
  await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true })
  await writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), 'noise')
  // A secret that lives OUTSIDE the workspace root — the thing confinement must
  // never expose.
  outside = path.join(base, 'secret.txt')
  await writeFile(outside, 'TOP SECRET')
  ws = new Workspace(() => undefined)
})

afterAll(async () => {
  if (root) await rm(path.dirname(root), { recursive: true, force: true })
})

describe('Workspace.tree', () => {
  it('lists source files and prunes ignored directories', async () => {
    const entries = await ws.tree(root)
    const rels = entries.map((e) => e.relPath)
    expect(rels).toContain('src/a.txt')
    expect(rels.some((r) => r.includes('node_modules'))).toBe(false)
  })

  it('marks an oversized file as not readable', async () => {
    const big = (await ws.tree(root)).find((e) => e.relPath === 'big.txt')
    expect(big?.readable).toBe(false)
  })

  // M6: a project folder that is gone (deleted, renamed, or on an unmounted
  // drive) used to be indistinguishable from an empty one — `walk` swallows
  // the readdir failure and returns [], so the caller saw "No files." and the
  // ENOENT catch in the IPC handler was dead code that could never fire.
  it('reports a root that is not on disk rather than returning an empty listing', async () => {
    await expect(ws.tree(path.join(root, 'no-such-folder'))).rejects.toBeInstanceOf(WorkspaceError)
    await expect(ws.tree(path.join(root, 'no-such-folder'))).rejects.toMatchObject({ code: 'not-found' })
  })

  it('still returns an empty listing for a folder that genuinely has no files', async () => {
    const empty = path.join(root, 'empty-dir')
    await mkdir(empty, { recursive: true })
    expect(await ws.tree(empty)).toEqual([])
  })

  it('reports a root that is a file, not a directory', async () => {
    await expect(ws.tree(path.join(root, 'big.txt'))).rejects.toMatchObject({ code: 'not-found' })
  })
})

describe('Workspace.read', () => {
  it('reads a text file inside the root', async () => {
    expect(await ws.read(root, 'src/a.txt')).toEqual({ relPath: 'src/a.txt', text: 'hello world' })
  })

  it('refuses to read outside the root via ..', async () => {
    // The core security assertion: a traversal to the sibling secret is rejected.
    await expect(ws.read(root, '../secret.txt')).rejects.toMatchObject({ code: 'outside-root' })
  })

  it('refuses a binary file', async () => {
    await expect(ws.read(root, 'bin.dat')).rejects.toMatchObject({ code: 'not-text' })
  })

  it('refuses an oversized file', async () => {
    await expect(ws.read(root, 'big.txt')).rejects.toMatchObject({ code: 'too-large' })
  })

  it('reports a missing file', async () => {
    await expect(ws.read(root, 'nope.txt')).rejects.toBeInstanceOf(WorkspaceError)
  })
})
