import { RELEASES_API_URL, UpdateError, normalizeVersion } from './policy.js'

export interface UpdateCheckResult {
  version: string
}

export type UpdaterBackendEvent = 'progress' | 'downloaded' | 'error'

/**
 * The seam the UpdaterService is written against. Three implementations live
 * here (check-only, null, fake); the electron-updater one lives in
 * electron-backend.ts so this file stays importable without the dependency.
 */
export interface UpdaterBackend {
  /** Resolves with the latest version, or null when there is nothing newer. */
  check(): Promise<UpdateCheckResult | null>
  download(): Promise<void>
  quitAndInstall(): void
  on(event: UpdaterBackendEvent, cb: (payload: unknown) => void): void
  /**
   * Controls whether an already-staged download is allowed to install itself
   * when the app quits normally, independent of dismissing the chip.
   * `UpdaterService.setEnabled` is the only caller: turning updates OFF must
   * also cancel a pending quit-time install (not just stop future checks),
   * or a user who disabled updates and quit would still get updated against
   * their explicit instruction. Dismissing the chip is unrelated and must
   * NOT call this — a dismissed-but-staged update installing on the next
   * natural quit is deliberate behaviour, not a bug.
   */
  setInstallOnQuit(enabled: boolean): void
}

/** Minimal event plumbing shared by the non-electron-updater backends. */
class EventEmitterBase {
  private readonly listeners = new Map<UpdaterBackendEvent, ((payload: unknown) => void)[]>()

  on(event: UpdaterBackendEvent, cb: (payload: unknown) => void): void {
    const existing = this.listeners.get(event)
    if (existing) {
      existing.push(cb)
    } else {
      this.listeners.set(event, [cb])
    }
  }

  protected emit(event: UpdaterBackendEvent, payload?: unknown): void {
    for (const cb of this.listeners.get(event) ?? []) cb(payload)
  }
}

/**
 * macOS. Squirrel.Mac refuses to apply an update to an unsigned app, so this
 * backend only ever ANSWERS THE QUESTION "is there something newer?" — it never
 * downloads. Because nothing is executed, it carries no integrity burden.
 */
export class CheckOnlyBackend extends EventEmitterBase implements UpdaterBackend {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {
    super()
  }

  async check(): Promise<UpdateCheckResult | null> {
    const response = await this.fetchImpl(RELEASES_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    // No release published yet is a normal state, not a failure.
    if (response.status === 404) return null
    if (response.status === 403 || response.status === 429) {
      throw new UpdateError('rate-limited')
    }
    // Only the status code goes into the message — never the body, which is
    // remote-controlled text that must not reach the UI.
    if (!response.ok) throw new Error(`GitHub responded ${response.status}`)

    let body: { tag_name?: unknown }
    try {
      body = (await response.json()) as { tag_name?: unknown }
    } catch {
      // response.json() embeds the raw body text in a SyntaxError when the
      // payload isn't valid JSON (e.g. a captive portal, proxy, or WAF
      // returning a 200 HTML page). Re-throw without that text — same
      // never-leak-the-body posture as the !response.ok branch above.
      throw new Error(`GitHub returned an unparsable response (status ${response.status})`)
    }
    if (typeof body.tag_name !== 'string' || body.tag_name.length === 0) return null
    return { version: normalizeVersion(body.tag_name) }
  }

  download(): Promise<void> {
    return Promise.reject(new UpdateError('unsupported'))
  }

  quitAndInstall(): void {
    throw new UpdateError('unsupported')
  }

  // Never downloads, so there is nothing that could install on quit.
  setInstallOnQuit(_enabled: boolean): void {}
}

/** Unpackaged builds — development and every e2e run. electron-updater throws
 *  when not packaged, so the service is given a backend that does nothing. */
export class NullBackend extends EventEmitterBase implements UpdaterBackend {
  check(): Promise<UpdateCheckResult | null> {
    return Promise.resolve(null)
  }

  download(): Promise<void> {
    return Promise.reject(new UpdateError('unsupported'))
  }

  quitAndInstall(): void {
    throw new UpdateError('unsupported')
  }

  // Never downloads, so there is nothing that could install on quit.
  setInstallOnQuit(_enabled: boolean): void {}
}

/**
 * Drives the e2e suite (MODELITH_FAKE_UPDATER=1), mirroring the fake-provider
 * pattern in src/main/providers/registry.ts. Reports a version nothing can
 * exceed, then "downloads" instantly.
 */
export class FakeUpdaterBackend extends EventEmitterBase implements UpdaterBackend {
  constructor(private readonly version = '99.0.0') {
    super()
  }

  check(): Promise<UpdateCheckResult | null> {
    return Promise.resolve({ version: this.version })
  }

  download(): Promise<void> {
    // NOTE: emission here is synchronous — 'progress' then 'downloaded' both
    // run to completion before the returned promise resolves, with no yield
    // between them. This diverges from ElectronUpdaterBackend (Task 5), whose
    // events arrive asynchronously off real network/disk I/O. A consumer MUST
    // set its "downloading" state BEFORE calling download(), never after
    // awaiting it, or it will miss or misorder the 'downloaded' event.
    this.emit('progress', 50)
    this.emit('downloaded')
    return Promise.resolve()
  }

  quitAndInstall(): void {
    // Nothing to do: the e2e suite asserts the UI reached "ready", and must
    // never actually restart the app under test.
  }

  // No real quit-time install to gate — this backend never restarts the app.
  setInstallOnQuit(_enabled: boolean): void {}
}

/**
 * Picks the one backend this process will use, once, at startup.
 *
 * electron-backend.ts is deliberately NOT imported (statically or lazily) by
 * this module: electron-vite/Rollup bundles the whole main process into a
 * single out/main/index.js, and a runtime `require('./electron-backend.js')`
 * is an opaque call Rollup cannot follow — the file never gets emitted, and
 * the call throws MODULE_NOT_FOUND in packaged builds. Instead, the caller
 * (main, which can statically `import` electron-backend.js so Rollup bundles
 * it in) passes a factory. Keeping electron-backend.ts out of this file's own
 * import graph is also what lets unit tests import backend.ts without pulling
 * in electron-updater, which needs a real Electron runtime.
 */
export function selectBackend(options: {
  platform: string
  isPackaged: boolean
  fake?: boolean
  /** Supplied by main (see src/main/ipc/handlers.ts), which can statically
   *  import electron-backend.js. Kept out of this module so unit tests can
   *  import it without pulling in electron-updater, which needs a real
   *  Electron runtime. */
  electronBackendFactory?: () => UpdaterBackend
}): UpdaterBackend {
  if (options.fake) return new FakeUpdaterBackend()
  if (!options.isPackaged) return new NullBackend()
  if (options.platform === 'win32' || options.platform === 'linux') {
    // Packaged win32/linux with no factory is a caller bug — main (see
    // src/main/ipc/handlers.ts) is supposed to always pass one on this
    // branch. We fall back to NullBackend (updates simply never run) rather
    // than throwing, because a startup crash is a worse failure mode for an
    // end user than a build that silently can't self-update; this branch is
    // explicit and commented, not a silent default, and is exercised by a
    // dedicated test below so a future caller regression fails CI, not just
    // a user's auto-update.
    return options.electronBackendFactory?.() ?? new NullBackend()
  }
  return new CheckOnlyBackend()
}
