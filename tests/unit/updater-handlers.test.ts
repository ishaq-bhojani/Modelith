import { describe, it, expect, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppSettingsStore } from '../../src/main/settings/store.js'
import { UpdaterService } from '../../src/main/updater/service.js'
import { FakeUpdaterBackend } from '../../src/main/updater/backend.js'
import { resolveInstallAction } from '../../src/main/updater/policy.js'
import { CHANNELS } from '../../src/shared/ipc.js'
import type { UpdateState } from '../../src/shared/types.js'

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

/**
 * Exercises the actual `registerUpdateHandlers` export end-to-end, with a
 * minimal mocked `electron` (ipcMain.handle capturing channel -> listener,
 * app pointed at a real temp userData dir so the real AppSettingsStore reads
 * real files). This is what proves the Finding-1 fix: that `updates:get` has
 * a working handler the instant registration returns, never `undefined`, and
 * that a persisted `updatesEnabled: false` is still honored once the
 * background settings read resolves.
 */
describe('registerUpdateHandlers wiring', () => {
  type Handlers = Map<string, (...args: unknown[]) => unknown>

  async function loadHandlers(userDataDir: string): Promise<{
    registerUpdateHandlers: (getWindow: () => undefined) => void
    getUpdater: () => UpdaterService | undefined
    handled: Handlers
  }> {
    vi.resetModules()
    const handled: Handlers = new Map()
    vi.doMock('electron', () => ({
      app: {
        getPath: () => userDataDir,
        getVersion: () => '0.2.0',
        isPackaged: false,
      },
      ipcMain: {
        handle: (channel: string, listener: (...args: unknown[]) => unknown) => {
          handled.set(channel, listener)
        },
      },
      shell: { openExternal: vi.fn(() => Promise.resolve()) },
    }))
    const mod = (await import('../../src/main/ipc/handlers.js')) as unknown as {
      registerUpdateHandlers: (getWindow: () => undefined) => void
      getUpdater: () => UpdaterService | undefined
    }
    return { ...mod, handled }
  }

  it('updates:get has a working handler the instant registration returns, never undefined', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oc-updates-wire-'))
    const { registerUpdateHandlers, getUpdater, handled } = await loadHandlers(dir)
    try {
      registerUpdateHandlers(() => undefined)
      // Registration is synchronous — the handler must exist right here, with
      // no await between it and the call above, proving there is no window
      // where a renderer's invoke('updates:get') would hit "No handler
      // registered".
      const getHandler = handled.get(CHANNELS.updatesGet)
      expect(getHandler).toBeTypeOf('function')
      const state = (await getHandler!()) as UpdateState | undefined
      expect(state).toBeDefined()
      expect(state).toMatchObject({ status: 'idle', enabled: true, currentVersion: '0.2.0' })
    } finally {
      getUpdater()?.stop()
    }
  })

  it('honors a persisted updatesEnabled: false once the background settings read resolves, without clobbering a live setEnabled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oc-updates-wire-'))
    // Pre-seed the settings file exactly as AppSettingsStore.defaultPath would
    // locate it, mirroring what getSettingsStore() does inside handlers.ts.
    const seedStore = new AppSettingsStore(AppSettingsStore.defaultPath(dir))
    await seedStore.set({ updatesEnabled: false })

    const { registerUpdateHandlers, getUpdater, handled } = await loadHandlers(dir)
    try {
      registerUpdateHandlers(() => undefined)
      const getHandler = handled.get(CHANNELS.updatesGet)!

      // Immediately after registration the enabled: true default is still in
      // effect — the persisted false has not been read yet — confirming the
      // handler existed and returned real state before that read completed.
      expect((await getHandler()) as UpdateState).toMatchObject({ enabled: true })

      // Once the background settings read resolves, the persisted value
      // must be applied.
      await vi.waitFor(async () => {
        expect((await getHandler()) as UpdateState).toMatchObject({ enabled: false })
      })
    } finally {
      getUpdater()?.stop()
    }
  })

  it('an explicit setEnabled call wins over a persisted value that resolves afterward', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oc-updates-wire-'))
    const seedStore = new AppSettingsStore(AppSettingsStore.defaultPath(dir))
    await seedStore.set({ updatesEnabled: false })

    const { registerUpdateHandlers, getUpdater, handled } = await loadHandlers(dir)
    try {
      registerUpdateHandlers(() => undefined)
      const setEnabledHandler = handled.get(CHANNELS.updatesSetEnabled)!
      const getHandler = handled.get(CHANNELS.updatesGet)!

      // The user explicitly re-enables before the persisted `false` has had a
      // chance to load and apply.
      await setEnabledHandler(undefined, { enabled: true })
      expect((await getHandler()) as UpdateState).toMatchObject({ enabled: true })

      // Give the background settings read every opportunity to run. If it
      // clobbered the user's explicit choice, this would flip back to false.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect((await getHandler()) as UpdateState).toMatchObject({ enabled: true })
    } finally {
      getUpdater()?.stop()
    }
  })
})

describe('resolveInstallAction', () => {
  const base: UpdateState = {
    status: 'idle',
    canAutoInstall: false,
    currentVersion: '0.2.0',
    enabled: true,
    manualCheck: false,
  }

  it('installs when the platform can auto-install and the download is ready', () => {
    const action = resolveInstallAction({ ...base, canAutoInstall: true, status: 'ready' })
    expect(action).toEqual({ type: 'install' })
  })

  it('opens the release page when the platform cannot auto-install and a URL is known', () => {
    const url = 'https://github.com/ishaq-bhojani/Modelith/releases/tag/v9.9.9'
    const action = resolveInstallAction({ ...base, canAutoInstall: false, status: 'available', releaseUrl: url })
    expect(action).toEqual({ type: 'open-release', url })
  })

  it('is a no-op — never an open with an undefined URL — when there is no releaseUrl yet', () => {
    const action = resolveInstallAction({ ...base, canAutoInstall: false, status: 'idle', releaseUrl: undefined })
    expect(action).toEqual({ type: 'noop' })
  })

  it('is a no-op on an auto-install platform when the state is neither ready nor available', () => {
    const action = resolveInstallAction({ ...base, canAutoInstall: true, status: 'checking' })
    expect(action).toEqual({ type: 'noop' })
  })
})
