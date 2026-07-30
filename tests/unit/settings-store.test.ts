import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppSettingsStore } from '../../src/main/settings/store.js'

let store: AppSettingsStore
let file: string

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oc-settings-'))
  file = join(dir, 'settings.json')
  store = new AppSettingsStore(file)
})

describe('AppSettingsStore', () => {
  it('returns an empty object before anything is written', async () => {
    expect(await store.get()).toEqual({})
  })

  it('persists and reads back a value', async () => {
    await store.set({ fallbacks: [{ providerId: 'anthropic', model: 'claude' }] })
    expect((await store.get())['fallbacks']).toEqual([{ providerId: 'anthropic', model: 'claude' }])
  })

  it('merges patches rather than replacing the whole object', async () => {
    await store.set({ a: 1 })
    await store.set({ b: 2 })
    expect(await store.get()).toEqual({ a: 1, b: 2 })
  })

  it('overwrites an existing key on patch', async () => {
    await store.set({ theme: 'dark' })
    await store.set({ theme: 'light' })
    expect((await store.get())['theme']).toBe('light')
  })

  it('falls back to defaults on a corrupt file rather than throwing', async () => {
    await writeFile(file, '{ not valid json', 'utf8')
    // Preferences are non-critical: a corrupt file should not block startup.
    expect(await store.get()).toEqual({})
  })

  it('does not lose a concurrent write', async () => {
    await Promise.all([store.set({ a: 1 }), store.set({ b: 2 })])
    expect(await store.get()).toEqual({ a: 1, b: 2 })
  })
})
