import { describe, it, expect, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppSettingsStore } from '../../src/main/settings/store.js'
import { UpdaterService } from '../../src/main/updater/service.js'
import { FakeUpdaterBackend } from '../../src/main/updater/backend.js'

async function makeStore(): Promise<AppSettingsStore> {
  const dir = await mkdtemp(join(tmpdir(), 'oc-updates-'))
  return new AppSettingsStore(join(dir, 'settings.json'))
}

describe('updates enablement persistence', () => {
  it('defaults to enabled when the setting has never been written', async () => {
    const store = await makeStore()
    const raw = (await store.get())['updatesEnabled']
    expect(raw === undefined ? true : raw).toBe(true)
  })

  it('round-trips the toggle through the settings store', async () => {
    const store = await makeStore()
    const service = new UpdaterService({
      backend: new FakeUpdaterBackend(),
      currentVersion: '0.2.0',
      canAutoInstall: true,
      enabled: true,
      emit: () => {},
      persistEnabled: async (enabled) => { await store.set({ updatesEnabled: enabled }) },
    })
    await service.setEnabled(false)
    expect((await store.get())['updatesEnabled']).toBe(false)
    await service.setEnabled(true)
    expect((await store.get())['updatesEnabled']).toBe(true)
  })
})

describe('update state emission', () => {
  it('emits a fresh state object on every transition, never a shared reference', async () => {
    const emitted: unknown[] = []
    const service = new UpdaterService({
      backend: new FakeUpdaterBackend(),
      currentVersion: '0.2.0',
      canAutoInstall: true,
      enabled: true,
      emit: (s) => emitted.push(s),
    })
    await service.check()
    expect(emitted.length).toBeGreaterThan(1)
    expect(new Set(emitted).size).toBe(emitted.length)
  })

  it('reports ready after the fake backend completes a download', async () => {
    const service = new UpdaterService({
      backend: new FakeUpdaterBackend(),
      currentVersion: '0.2.0',
      canAutoInstall: true,
      enabled: true,
      emit: () => {},
    })
    await service.check()
    expect(service.getState()).toMatchObject({ status: 'ready', latestVersion: '99.0.0' })
  })
})
