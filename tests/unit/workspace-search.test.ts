import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Workspace } from '../../src/main/workspace/service.js'
import type { AppSettingsStore } from '../../src/main/settings/store.js'

function fakeSettings(root: string): AppSettingsStore {
  return { get: async () => ({ workspaceRoot: root }), set: async () => {} } as unknown as AppSettingsStore
}

let root: string
let ws: Workspace

beforeAll(async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'oc-search-'))
  root = path.join(base, 'project')
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(path.join(root, 'src', 'a.ts'), 'const needleValue = 1\nother line\n')
  await writeFile(path.join(root, 'src', 'b.ts'), 'no match here\nNEEDLEVALUE upper\n')
  await writeFile(path.join(root, 'bin.dat'), Buffer.from([0x00, 0x6e, 0x65, 0x65, 0x64, 0x00])) // "nee" around NULs
  await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true })
  await writeFile(path.join(root, 'node_modules', 'pkg', 'i.js'), 'needleValue in deps')
  ws = new Workspace(fakeSettings(root), () => undefined)
})
afterAll(async () => { if (root) await rm(path.dirname(root), { recursive: true, force: true }) })

describe('Workspace.search', () => {
  it('finds a case-insensitive substring across files with line numbers', async () => {
    const res = await ws.search('needlevalue')
    const locations = res.hits.map((h) => `${h.relPath}:${h.line}`)
    expect(locations).toContain('src/a.ts:1')
    expect(locations).toContain('src/b.ts:2')
    expect(res.hits.find((h) => h.relPath === 'nonexistent.ts')?.text).toBeUndefined() // sanity: verify no hits for missing files
    expect(res.hits.find((h) => h.line === 1 && h.relPath === 'src/a.ts')?.text).toContain('needleValue')
  })

  it('prunes ignored directories (node_modules is never scanned)', async () => {
    const res = await ws.search('needlevalue')
    expect(res.hits.some((h) => h.relPath.includes('node_modules'))).toBe(false)
  })

  it('skips binary files', async () => {
    const res = await ws.search('nee')
    expect(res.hits.some((h) => h.relPath === 'bin.dat')).toBe(false)
  })

  it('caps hits and flags truncation', async () => {
    const res = await ws.search('e', { maxHits: 1 }) // 'e' is common
    expect(res.hits.length).toBe(1)
    expect(res.truncated).toBe(true)
  })

  it('returns no hits and does not throw for an empty query', async () => {
    const res = await ws.search('')
    expect(res.hits).toEqual([])
    expect(res.truncated).toBe(false)
  })
})
