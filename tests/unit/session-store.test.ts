import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionStore } from '../../src/main/sessions/store.js'
import type { ChatMessage } from '../../src/shared/types.js'

const msg = (id: string, content: string): ChatMessage =>
  ({ id, role: 'user', content, createdAt: 1 })

let store: SessionStore
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'oc-sessions-'))
  store = new SessionStore(dir)
})

describe('SessionStore', () => {
  it('creates a session with a unique id', async () => {
    const a = await store.create('First')
    const b = await store.create('Second')
    expect(a.id).not.toBe(b.id)
    expect(a.title).toBe('First')
  })

  it('appends and reloads messages in order', async () => {
    const s = await store.create('t')
    await store.append(s.id, msg('1', 'one'))
    await store.append(s.id, msg('2', 'two'))
    expect((await store.load(s.id)).map((m) => m.content)).toEqual(['one', 'two'])
  })

  it('writes one JSON object per line', async () => {
    const s = await store.create('t')
    await store.append(s.id, msg('1', 'one'))
    await store.append(s.id, msg('2', 'two'))
    const raw = await readFile(join(dir, `${s.id}.jsonl`), 'utf8')
    expect(raw.trimEnd().split('\n')).toHaveLength(2)
  })

  it('survives a truncated trailing line', async () => {
    const s = await store.create('t')
    await store.append(s.id, msg('1', 'one'))
    const { appendFile } = await import('node:fs/promises')
    await appendFile(join(dir, `${s.id}.jsonl`), '{"id":"2","rol')
    expect((await store.load(s.id)).map((m) => m.content)).toEqual(['one'])
  })

  it('lists sessions newest first', async () => {
    const a = await store.create('A')
    await new Promise((r) => setTimeout(r, 5))
    const b = await store.create('B')
    expect((await store.list()).map((s) => s.id)).toEqual([b.id, a.id])
  })

  it('removes a session and its messages', async () => {
    const s = await store.create('t')
    await store.append(s.id, msg('1', 'one'))
    await store.remove(s.id)
    expect(await store.list()).toEqual([])
    expect(await store.load(s.id)).toEqual([])
  })

  it('renames a session', async () => {
    const s = await store.create('old')
    await store.rename(s.id, 'new')
    expect((await store.list())[0]?.title).toBe('new')
  })

  it('rejects an id containing path separators', async () => {
    await expect(store.load('../../etc/passwd')).rejects.toThrow(/invalid session id/i)
  })

  // --- Additional coverage per review notes ---

  it('rejects ids with backslashes, absolute paths, and drive letters', async () => {
    await expect(store.load('..\\..\\windows\\system32')).rejects.toThrow(/invalid session id/i)
    await expect(store.load('/etc/passwd')).rejects.toThrow(/invalid session id/i)
    await expect(store.load('C:\\Windows')).rejects.toThrow(/invalid session id/i)
    await expect(store.load('a/../../b')).rejects.toThrow(/invalid session id/i)
  })

  it('does not lose an index update when appends race across sessions', async () => {
    const a = await store.create('A')
    const b = await store.create('B')
    const c = await store.create('C')
    // Give the initial updatedAt values room to be distinguished from a
    // subsequent refresh: without this gap, Date.now() could return the same
    // millisecond for creation and the race below, making the test pass
    // spuriously even against unserialized index writes.
    await new Promise((r) => setTimeout(r, 5))
    await Promise.all([
      store.append(a.id, msg('1', 'one')),
      store.append(b.id, msg('1', 'one')),
      store.append(c.id, msg('1', 'one')),
    ])
    const index = await store.list()
    const byId = new Map(index.map((s) => [s.id, s]))
    // Under an unserialized read-modify-write, three concurrent appends across
    // three sessions all read the same initial index snapshot; each write then
    // clobbers the previous one, so only the last writer's updatedAt survives
    // and at least two of the three sessions keep their original creation
    // timestamp. Serialization requires all three to have refreshed.
    expect(byId.get(a.id)?.updatedAt).toBeGreaterThan(a.updatedAt)
    expect(byId.get(b.id)?.updatedAt).toBeGreaterThan(b.updatedAt)
    expect(byId.get(c.id)?.updatedAt).toBeGreaterThan(c.updatedAt)
  })

  it('does not lose a create when two sessions are created concurrently', async () => {
    const [a, b] = await Promise.all([store.create('A'), store.create('B')])
    const ids = (await store.list()).map((s) => s.id)
    expect(ids).toContain(a.id)
    expect(ids).toContain(b.id)
  })

  it('does not lose a remove when racing against a concurrent append', async () => {
    const a = await store.create('A')
    const b = await store.create('B')
    await Promise.all([store.remove(a.id), store.append(b.id, msg('1', 'one'))])
    const ids = (await store.list()).map((s) => s.id)
    expect(ids).not.toContain(a.id)
    expect(ids).toContain(b.id)
  })

  it('throws rather than silently reporting zero sessions for a corrupt index', async () => {
    await store.create('A')
    await writeFile(join(dir, 'index.json'), '{ not valid json', 'utf8')
    await expect(store.list()).rejects.toThrow()
  })

  it('does not overwrite a corrupt index on a subsequent create', async () => {
    const corrupt = '{ not valid json'
    await writeFile(join(dir, 'index.json'), corrupt, 'utf8')
    await expect(store.create('A')).rejects.toThrow()
    expect(await readFile(join(dir, 'index.json'), 'utf8')).toBe(corrupt)
  })

  it('does not leave an orphaned .jsonl file when create fails on a corrupt index', async () => {
    const corrupt = '{ not valid json'
    await writeFile(join(dir, 'index.json'), corrupt, 'utf8')
    await expect(store.create('A')).rejects.toThrow()
    const { readdir } = await import('node:fs/promises')
    const files = await readdir(dir)
    expect(files.filter((f) => f.endsWith('.jsonl'))).toEqual([])
  })

  it('returns empty (not an error) when the index does not exist yet', async () => {
    expect(await store.list()).toEqual([])
  })
})
