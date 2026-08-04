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
}

/** Minimal event plumbing shared by the non-electron-updater backends. */
class EventEmitterBase {
  private readonly listeners = new Map<UpdaterBackendEvent, ((payload: unknown) => void)[]>()

  on(event: UpdaterBackendEvent, cb: (payload: unknown) => void): void {
    const existing = this.listeners.get(event) ?? []
    existing.push(cb)
    this.listeners.set(event, existing)
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

    const body = (await response.json()) as { tag_name?: unknown }
    if (typeof body.tag_name !== 'string' || body.tag_name.length === 0) return null
    return { version: normalizeVersion(body.tag_name) }
  }

  download(): Promise<void> {
    return Promise.reject(new UpdateError('unsupported'))
  }

  quitAndInstall(): void {
    throw new UpdateError('unsupported')
  }
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
    this.emit('progress', 50)
    this.emit('downloaded')
    return Promise.resolve()
  }

  quitAndInstall(): void {
    // Nothing to do: the e2e suite asserts the UI reached "ready", and must
    // never actually restart the app under test.
  }
}
