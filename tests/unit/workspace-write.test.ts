import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Workspace } from '../../src/main/workspace/service.js'
import { CheckpointStore } from '../../src/main/workspace/checkpoints.js'
import type { AppSettingsStore } from '../../src/main/settings/store.js'

function fakeSettings(root: string): AppSettingsStore {
  return { get: async () => ({ workspaceRoot: root }), set: async () => {} } as unknown as AppSettingsStore
}

let base: string
let root: string
let ws: Workspace

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'oc-wr-'))
  root = path.join(base, 'project')
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, 'a.txt'), 'original')
  const checkpoints = new CheckpointStore(path.join(base, 'checkpoints'))
  ws = new Workspace(fakeSettings(root), () => undefined, checkpoints)
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
    const n = await ws.revertTurn(root, 't1')
    expect(n).toBe(1)
    expect(await readFile(path.join(root, 'a.txt'), 'utf8')).toBe('original')
  })

  it('deletes a file that did not exist before the write', async () => {
    await ws.applyWrite(root, { relPath: 'created.txt', content: 'hi', turnId: 't2', callId: 'c1' })
    await ws.revertTurn(root, 't2')
    await expect(stat(path.join(root, 'created.txt'))).rejects.toBeTruthy()
  })

  it('reverts multiple edits in one turn', async () => {
    await ws.applyWrite(root, { relPath: 'a.txt', content: 'v2', turnId: 't3', callId: 'c1' })
    await ws.applyWrite(root, { relPath: 'b.txt', content: 'newb', turnId: 't3', callId: 'c2' })
    const n = await ws.revertTurn(root, 't3')
    expect(n).toBe(2)
    expect(await readFile(path.join(root, 'a.txt'), 'utf8')).toBe('original')
    await expect(stat(path.join(root, 'b.txt'))).rejects.toBeTruthy()
  })
})
