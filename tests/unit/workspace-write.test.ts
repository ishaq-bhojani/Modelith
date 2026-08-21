import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Workspace } from '../../src/main/workspace/service.js'
import { CheckpointStore } from '../../src/main/workspace/checkpoints.js'


let base: string
let root: string
let ws: Workspace
let checkpoints: CheckpointStore

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'oc-wr-'))
  root = path.join(base, 'project')
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, 'a.txt'), 'original')
  checkpoints = new CheckpointStore(path.join(base, 'checkpoints'))
  ws = new Workspace(() => undefined, checkpoints)
})
afterEach(async () => { await rm(base, { recursive: true, force: true }) })

describe('Workspace.applyWrite', () => {
  it('overwrites an existing file inside the root', async () => {
    await ws.applyWrite(root, { relPath: 'a.txt', content: 'changed', turnId: 't1', callId: 'c1' })
    expect(await readFile(path.join(root, 'a.txt'), 'utf8')).toBe('changed')
  })

  it('creates a new file inside the root', async () => {
    await ws.applyWrite(root, { relPath: 'new.txt', content: 'hi', turnId: 't1', callId: 'c1' })
    expect(await readFile(path.join(root, 'new.txt'), 'utf8')).toBe('hi')
  })

  it('refuses to write outside the root', async () => {
    await expect(
      ws.applyWrite(root, { relPath: '../escape.txt', content: 'x', turnId: 't1', callId: 'c1' }),
    ).rejects.toMatchObject({ code: 'outside-root' })
    // Nothing was written to the sibling location.
    await expect(stat(path.join(base, 'escape.txt'))).rejects.toBeTruthy()
  })
})

describe('Workspace.revertTurn', () => {
  it('restores an overwritten file to its pre-image', async () => {
    await ws.applyWrite(root, { relPath: 'a.txt', content: 'changed', turnId: 't1', callId: 'c1' })
    const n = await ws.revertTurn('t1')
    expect(n).toBe(1)
    expect(await readFile(path.join(root, 'a.txt'), 'utf8')).toBe('original')
  })

  it('deletes a file that did not exist before the write', async () => {
    await ws.applyWrite(root, { relPath: 'created.txt', content: 'hi', turnId: 't2', callId: 'c1' })
    await ws.revertTurn('t2')
    await expect(stat(path.join(root, 'created.txt'))).rejects.toBeTruthy()
  })

  it('reverts multiple edits in one turn', async () => {
    await ws.applyWrite(root, { relPath: 'a.txt', content: 'v2', turnId: 't3', callId: 'c1' })
    await ws.applyWrite(root, { relPath: 'b.txt', content: 'newb', turnId: 't3', callId: 'c2' })
    const n = await ws.revertTurn('t3')
    expect(n).toBe(2)
    expect(await readFile(path.join(root, 'a.txt'), 'utf8')).toBe('original')
    await expect(stat(path.join(root, 'b.txt'))).rejects.toBeTruthy()
  })
})

describe('Workspace.revertTurn across projects', () => {
  it('restores into the project the write happened in, not the active one', async () => {
    // A second project, holding a DIFFERENT file at the same relative path.
    const other = path.join(base, 'other-project')
    await mkdir(other, { recursive: true })
    await writeFile(path.join(other, 'a.txt'), 'the other project')

    // A turn edits project A's a.txt, so the checkpoint belongs to project A.
    await ws.applyWrite(root, { relPath: 'a.txt', content: 'changed', turnId: 't9', callId: 'c1' })

    // Revert is given no root at all, so the only root in play is the one the
    // checkpoint recorded. That is what makes the destructive case impossible:
    // when the UI later hands revert the ACTIVE project instead (the user
    // switched projects before clicking Revert), the pre-image would land on
    // this other project's file at the same relative path and silently destroy
    // work in a project they were not even looking at.
    const n = await ws.revertTurn('t9')

    expect(n).toBe(1)
    expect(await readFile(path.join(other, 'a.txt'), 'utf8')).toBe('the other project')
    expect(await readFile(path.join(root, 'a.txt'), 'utf8')).toBe('original')
  })

  it('skips a checkpoint that recorded no root instead of guessing one', async () => {
    // What an upgrade finds on disk: a checkpoint written before roots were
    // recorded. There is no safe way to place its pre-image, and guessing is
    // the destructive behaviour above — so it is skipped, not thrown on, and
    // not counted.
    await checkpoints.record({ turnId: 't10', callId: 'c1', relPath: 'a.txt', existed: true, prevBase64: Buffer.from('legacy').toString('base64') })

    await expect(ws.revertTurn('t10')).resolves.toBe(0)
    expect(await readFile(path.join(root, 'a.txt'), 'utf8')).toBe('original')
  })

  it('skips a checkpoint whose recorded root is gone from disk', async () => {
    const vanishing = path.join(base, 'unmounted')
    await mkdir(vanishing, { recursive: true })
    await writeFile(path.join(vanishing, 'a.txt'), 'was here')
    await ws.applyWrite(vanishing, { relPath: 'a.txt', content: 'changed', turnId: 't11', callId: 'c1' })

    // The folder is deleted, renamed, or on an unmounted drive by the time the
    // user reverts. Nothing can be restored, but the revert must not throw and
    // must not look elsewhere for somewhere to put the bytes.
    await rm(vanishing, { recursive: true, force: true })

    await expect(ws.revertTurn('t11')).resolves.toBe(0)
    expect(await readFile(path.join(root, 'a.txt'), 'utf8')).toBe('original')
  })
})
