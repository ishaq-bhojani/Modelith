import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { UpdaterService } from '../../src/main/updater/service.js'
import type { UpdaterBackend, UpdateCheckResult, UpdaterBackendEvent } from '../../src/main/updater/backend.js'
import type { UpdateState } from '../../src/shared/types.js'
import { CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS, UpdateError } from '../../src/main/updater/policy.js'

class FakeBackend implements UpdaterBackend {
  checkResult: UpdateCheckResult | null = { version: '0.3.0' }
  checkError: unknown = null
  downloadError: unknown = null
  checkCalls = 0
  downloadCalls = 0
  quitCalls = 0
  private readonly listeners = new Map<UpdaterBackendEvent, ((p: unknown) => void)[]>()

  async check(): Promise<UpdateCheckResult | null> {
    this.checkCalls += 1
    if (this.checkError) throw this.checkError
    return this.checkResult
  }

  async download(): Promise<void> {
    this.downloadCalls += 1
    if (this.downloadError) throw this.downloadError
  }

  quitAndInstall(): void {
    this.quitCalls += 1
  }

  on(event: UpdaterBackendEvent, cb: (p: unknown) => void): void {
    const list = this.listeners.get(event) ?? []
    list.push(cb)
    this.listeners.set(event, list)
  }

  fire(event: UpdaterBackendEvent, payload?: unknown): void {
    for (const cb of this.listeners.get(event) ?? []) cb(payload)
  }
}

function makeService(overrides: Partial<{
  backend: FakeBackend; canAutoInstall: boolean; enabled: boolean; currentVersion: string
  persistEnabled: (enabled: boolean) => Promise<void>
}> = {}) {
  const backend = overrides.backend ?? new FakeBackend()
  const states: UpdateState[] = []
  const service = new UpdaterService({
    backend,
    currentVersion: overrides.currentVersion ?? '0.2.0',
    canAutoInstall: overrides.canAutoInstall ?? true,
    enabled: overrides.enabled ?? true,
    emit: (s) => states.push(s),
    now: () => 1_000,
    ...(overrides.persistEnabled ? { persistEnabled: overrides.persistEnabled } : {}),
  })
  return { service, backend, states }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('UpdaterService — happy path', () => {
  it('starts idle at the current version', () => {
    const { service } = makeService()
    expect(service.getState()).toMatchObject({ status: 'idle', currentVersion: '0.2.0', enabled: true })
  })

  it('moves through checking to available and records the release URL', async () => {
    const { service, states } = makeService({ canAutoInstall: false })
    await service.check()
    // Assert the transition boundaries, not the exact emit count: `check()`
    // patches lastCheckedAt mid-flight, which legitimately emits 'checking'
    // more than once.
    expect(states[0]!.status).toBe('checking')
    expect(states.at(-1)!.status).toBe('available')
    expect(states.some((s) => s.status === 'checking')).toBe(true)
    expect(service.getState()).toMatchObject({
      status: 'available',
      latestVersion: '0.3.0',
      releaseUrl: 'https://github.com/ishaq-bhojani/Modelith/releases/tag/v0.3.0',
    })
  })

  it('auto-downloads when the platform can install', async () => {
    const { service, backend } = makeService({ canAutoInstall: true })
    await service.check()
    expect(backend.downloadCalls).toBe(1)
    expect(service.getState().status).toBe('downloading')
  })

  it('reaches ready when the backend reports the download finished', async () => {
    const { service, backend } = makeService({ canAutoInstall: true })
    await service.check()
    backend.fire('downloaded')
    expect(service.getState()).toMatchObject({ status: 'ready', percent: 100 })
  })

  it('tracks download progress', async () => {
    const { service, backend } = makeService({ canAutoInstall: true })
    await service.check()
    backend.fire('progress', 42)
    expect(service.getState().percent).toBe(42)
  })

  it('records lastCheckedAt on a successful check', async () => {
    const { service } = makeService()
    await service.check()
    expect(service.getState().lastCheckedAt).toBe(1_000)
  })
})

describe('UpdaterService — macOS (cannot auto-install)', () => {
  it('stops at available and never downloads', async () => {
    const { service, backend } = makeService({ canAutoInstall: false })
    await service.check()
    expect(service.getState().status).toBe('available')
    expect(backend.downloadCalls).toBe(0)
  })
})

describe('UpdaterService — no update', () => {
  it('returns to idle when the backend reports nothing newer', async () => {
    const backend = new FakeBackend()
    backend.checkResult = null
    const { service } = makeService({ backend })
    await service.check()
    expect(service.getState()).toMatchObject({ status: 'idle', latestVersion: undefined })
  })

  it('returns to idle when the reported version is not newer', async () => {
    const backend = new FakeBackend()
    backend.checkResult = { version: '0.1.0' }
    const { service } = makeService({ backend })
    await service.check()
    expect(service.getState().status).toBe('idle')
  })
})

describe('UpdaterService — failures never throw', () => {
  it('turns a check failure into error state instead of rejecting', async () => {
    const backend = new FakeBackend()
    backend.checkError = new UpdateError('rate-limited')
    const { service } = makeService({ backend })
    await expect(service.check()).resolves.toBeUndefined()
    expect(service.getState()).toMatchObject({ status: 'error' })
    expect(service.getState().message).toMatch(/later/i)
  })

  it('turns a download failure into error state', async () => {
    const backend = new FakeBackend()
    backend.downloadError = new Error('sha512 mismatch')
    const { service } = makeService({ backend })
    await service.check()
    expect(service.getState()).toMatchObject({ status: 'error' })
    expect(service.getState().message).toMatch(/verif/i)
  })

  it('turns a backend error event into error state', async () => {
    const { service, backend } = makeService()
    backend.fire('error', new Error('boom'))
    expect(service.getState().status).toBe('error')
  })

  it('never puts raw error text into the message', async () => {
    const backend = new FakeBackend()
    backend.checkError = new Error('token-abc123')
    const { service } = makeService({ backend })
    await service.check()
    expect(service.getState().message).not.toContain('token-abc123')
  })
})

describe('UpdaterService — manualCheck flag', () => {
  it('is false for a background check', async () => {
    const backend = new FakeBackend()
    backend.checkError = new Error('offline')
    const { service } = makeService({ backend })
    await service.check()
    expect(service.getState().manualCheck).toBe(false)
  })

  it('is true for a user-requested check', async () => {
    const backend = new FakeBackend()
    backend.checkError = new Error('offline')
    const { service } = makeService({ backend })
    await service.check(true)
    expect(service.getState().manualCheck).toBe(true)
  })
})

describe('UpdaterService — enablement', () => {
  it('skips a background check when disabled', async () => {
    const { service, backend } = makeService({ enabled: false })
    await service.check()
    expect(backend.checkCalls).toBe(0)
  })

  it('still honours an explicit manual check when disabled', async () => {
    const { service, backend } = makeService({ enabled: false })
    await service.check(true)
    expect(backend.checkCalls).toBe(1)
  })

  it('persists the toggle', async () => {
    const persistEnabled = vi.fn().mockResolvedValue(undefined)
    const { service } = makeService({ persistEnabled })
    await service.setEnabled(false)
    expect(persistEnabled).toHaveBeenCalledWith(false)
    expect(service.getState().enabled).toBe(false)
  })

  it('does not schedule checks when start() runs while disabled', () => {
    const { service, backend } = makeService({ enabled: false })
    service.start()
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS + CHECK_INTERVAL_MS)
    expect(backend.checkCalls).toBe(0)
  })
})

describe('UpdaterService — scheduling', () => {
  it('checks once after the startup delay, not immediately', () => {
    const { service, backend } = makeService()
    service.start()
    expect(backend.checkCalls).toBe(0)
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS)
    expect(backend.checkCalls).toBe(1)
    service.stop()
  })

  it('re-checks on the interval', async () => {
    // canAutoInstall: false keeps each cycle at 'available' rather than
    // 'downloading' — the fake backend never emits 'downloaded' on its own,
    // so with the default canAutoInstall: true the state would get stuck in
    // 'downloading' after the first check and the re-entrancy guard would
    // swallow every later tick regardless of timer flushing. This test is
    // about the schedule, not download completion, so sidestep that here.
    const { service, backend } = makeService({ canAutoInstall: false })
    service.start()
    // advanceTimersByTimeAsync (not advanceTimersByTime) flushes microtasks
    // between ticks, so each check() settles before the next interval fires.
    // With the synchronous variant the awaited check never resolves, the
    // re-entrancy guard swallows every later tick, and the test would assert
    // the guard rather than the schedule.
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS)
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    expect(backend.checkCalls).toBe(3)
    service.stop()
  })

  it('stops firing after stop()', () => {
    const { service, backend } = makeService()
    service.start()
    service.stop()
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS + CHECK_INTERVAL_MS * 3)
    expect(backend.checkCalls).toBe(0)
  })

  it('ignores a re-entrant check while one is in flight', async () => {
    const { service, backend } = makeService()
    const first = service.check()
    const second = service.check()
    await Promise.all([first, second])
    expect(backend.checkCalls).toBe(1)
  })
})

describe('UpdaterService — install', () => {
  it('installs only from the ready state', async () => {
    const { service, backend } = makeService()
    service.install()
    expect(backend.quitCalls).toBe(0)
    await service.check()
    backend.fire('downloaded')
    service.install()
    expect(backend.quitCalls).toBe(1)
  })
})
