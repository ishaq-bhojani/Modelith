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
  installOnQuitCalls: boolean[] = []
  setInstallOnQuitError: unknown = null
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

  setInstallOnQuit(enabled: boolean): void {
    this.installOnQuitCalls.push(enabled)
    if (this.setInstallOnQuitError) throw this.setInstallOnQuitError
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
  now: () => number
}> = {}) {
  const backend = overrides.backend ?? new FakeBackend()
  const states: UpdateState[] = []
  const service = new UpdaterService({
    backend,
    currentVersion: overrides.currentVersion ?? '0.2.0',
    canAutoInstall: overrides.canAutoInstall ?? true,
    enabled: overrides.enabled ?? true,
    emit: (s) => states.push(s),
    now: overrides.now ?? (() => 1_000),
    ...(overrides.persistEnabled ? { persistEnabled: overrides.persistEnabled } : {}),
  })
  return { service, backend, states }
}

/** A `now` that jumps well past MANUAL_CHECK_MIN_INTERVAL_MS on every call, so
 *  tests about something other than throttling can issue back-to-back manual
 *  checks without tripping it. */
function everAdvancingClock(): () => number {
  let t = 1_000
  return () => {
    t += 60_000
    return t
  }
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
    // FakeBackend's download() resolves without ever emitting 'downloaded'.
    // A resolved download() IS a completed download, so the service treats
    // that resolution itself as completion rather than parking in
    // 'downloading' forever — see the 'never gets stuck in downloading'
    // test below for why that distinction matters.
    expect(service.getState().status).toBe('ready')
  })

  it('reaches ready when the backend reports the download finished', async () => {
    const { service, backend } = makeService({ canAutoInstall: true })
    await service.check()
    backend.fire('downloaded')
    expect(service.getState()).toMatchObject({ status: 'ready', percent: 100 })
  })

  it('tracks download progress while the download is still in flight', async () => {
    // FakeBackend's download() normally resolves on its own tick, and a
    // resolved download() now means status has already moved to 'ready'
    // (see the 'never gets stuck in downloading' test) — so a progress event
    // fired after check() has settled arrives too late to matter, by design.
    // To exercise progress tracking honestly this backend's download() must
    // still be in flight when the event fires, so it is overridden here to
    // hang until resolved explicitly.
    const backend = new FakeBackend()
    let resolveDownload: () => void = () => {}
    backend.download = () => new Promise<void>((resolve) => { resolveDownload = resolve })
    const { service } = makeService({ backend, canAutoInstall: true })

    const pending = service.check()
    for (let i = 0; i < 10 && service.getState().status !== 'downloading'; i += 1) {
      await Promise.resolve()
    }
    expect(service.getState().status).toBe('downloading')

    backend.fire('progress', 42)
    expect(service.getState().percent).toBe(42)

    resolveDownload()
    await pending
    expect(service.getState().status).toBe('ready')
  })

  it('records lastCheckedAt on a successful check', async () => {
    const { service } = makeService()
    await service.check()
    expect(service.getState().lastCheckedAt).toBe(1_000)
  })
})

describe('UpdaterService — a throwing emit consumer', () => {
  it('never lets a throwing emit escape check(), and state still advances', async () => {
    const backend = new FakeBackend()
    let emitCalls = 0
    const service = new UpdaterService({
      backend,
      currentVersion: '0.2.0',
      canAutoInstall: false,
      enabled: true,
      now: () => 1_000,
      emit: () => {
        emitCalls += 1
        // Simulates window.webContents.send after the BrowserWindow was
        // destroyed mid-check (Task 6's real emit).
        throw new Error('Object has been destroyed')
      },
    })

    await expect(service.check()).resolves.toBeUndefined()
    expect(emitCalls).toBeGreaterThan(0)
    // The state machine's own copy must have advanced normally even though
    // every emit attempt threw.
    expect(service.getState()).toMatchObject({
      status: 'available',
      latestVersion: '0.3.0',
    })
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

  it('clears a stale releaseUrl and percent when a later check finds nothing newer', async () => {
    const backend = new FakeBackend()
    // The second check below is manual and must not be swallowed by the
    // manual-check throttle (Finding 4) — advance the clock between calls.
    const { service } = makeService({ backend, canAutoInstall: false, now: everAdvancingClock() })
    // First cycle finds an update: releaseUrl gets set.
    await service.check()
    expect(service.getState()).toMatchObject({ status: 'available', releaseUrl: expect.any(String) })

    // Second cycle finds nothing newer — the prior releaseUrl (and any
    // percent) must not survive under status: 'idle', or a renderer reading
    // those fields without checking status would follow a ghost link.
    backend.checkResult = null
    await service.check(true)
    expect(service.getState()).toMatchObject({ status: 'idle', releaseUrl: undefined, percent: undefined })
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

  it('does not reject when persistEnabled rejects, and the toggle still takes effect', async () => {
    const persistEnabled = vi.fn().mockRejectedValue(new Error('disk full'))
    const { service } = makeService({ persistEnabled })
    await expect(service.setEnabled(false)).resolves.toBeUndefined()
    expect(service.getState().enabled).toBe(false)
    expect(service.getState().status).toBe('error')
  })

  it('does not schedule checks when start() runs while disabled', () => {
    const { service, backend } = makeService({ enabled: false })
    service.start()
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS + CHECK_INTERVAL_MS)
    expect(backend.checkCalls).toBe(0)
  })

  it('setEnabled(false) disables install-on-quit on the backend', async () => {
    const { service, backend } = makeService()
    await service.setEnabled(false)
    expect(backend.installOnQuitCalls).toContain(false)
    expect(backend.installOnQuitCalls.at(-1)).toBe(false)
  })

  it('setEnabled(true) re-enables install-on-quit on the backend', async () => {
    const { service, backend } = makeService()
    await service.setEnabled(false)
    await service.setEnabled(true)
    expect(backend.installOnQuitCalls.at(-1)).toBe(true)
  })

  it('does not reject when the backend throws from setInstallOnQuit', async () => {
    const backend = new FakeBackend()
    backend.setInstallOnQuitError = new Error('boom')
    const { service } = makeService({ backend })
    await expect(service.setEnabled(false)).resolves.toBeUndefined()
    // The toggle itself must still take effect even though the backend call failed.
    expect(service.getState().enabled).toBe(false)
  })
})

describe('UpdaterService — manual check throttling', () => {
  it('throttles a second manual check made too soon after the first', async () => {
    const { service, backend } = makeService({ canAutoInstall: false })
    await service.check(true)
    expect(backend.checkCalls).toBe(1)

    await service.check(true)
    // The backend must not be hit again — this is the whole point of the throttle.
    expect(backend.checkCalls).toBe(1)
    // The user pressed a button and must get truthful feedback, not silence.
    expect(service.getState()).toMatchObject({ status: 'error', manualCheck: true })
    expect(service.getState().message).toMatch(/recently|again/i)
  })

  it('does not throttle a manual check once the minimum interval has passed', async () => {
    let now = 1_000
    const backend = new FakeBackend()
    const service = new UpdaterService({
      backend,
      currentVersion: '0.2.0',
      canAutoInstall: false,
      enabled: true,
      emit: () => {},
      now: () => now,
    })
    await service.check(true)
    expect(backend.checkCalls).toBe(1)

    now += 60_000 // well past MANUAL_CHECK_MIN_INTERVAL_MS
    await service.check(true)
    expect(backend.checkCalls).toBe(2)
  })

  it('does not throttle a background check even immediately after a manual one', async () => {
    const { service, backend } = makeService({ canAutoInstall: false })
    await service.check(true)
    expect(backend.checkCalls).toBe(1)

    await service.check(false)
    expect(backend.checkCalls).toBe(2)
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

describe('UpdaterService — download resolves without a downloaded event', () => {
  it('reaches ready anyway, and a later check is not swallowed by the guard', async () => {
    // The second check below is manual and must not be swallowed by the
    // manual-check throttle (Finding 4) — advance the clock between calls.
    const { service, backend } = makeService({ canAutoInstall: true, now: everAdvancingClock() })
    await service.check()
    // FakeBackend.download() resolves but never fires 'downloaded' — before
    // the fix this parked state in 'downloading' forever and the
    // re-entrancy guard silently swallowed every future check.
    expect(service.getState().status).toBe('ready')

    const second = await service.check(true)
    expect(second).toBeUndefined()
    expect(backend.checkCalls).toBe(2)
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
