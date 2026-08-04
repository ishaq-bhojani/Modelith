import type { UpdateState } from '../../shared/types.js'
import type { UpdaterBackend } from './backend.js'
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  isNewerVersion,
  releaseUrlFor,
  updateErrorMessage,
} from './policy.js'

export interface UpdaterServiceOptions {
  backend: UpdaterBackend
  currentVersion: string
  canAutoInstall: boolean
  enabled: boolean
  emit: (state: UpdateState) => void
  now?: () => number
  persistEnabled?: (enabled: boolean) => Promise<void>
}

/**
 * Owns the update lifecycle and the single UpdateState the renderer mirrors.
 *
 * The backend is injected rather than constructed here, which is what keeps
 * this state machine testable: the whole class is exercised against a fake with
 * no Electron, no network, and no packaged app.
 *
 * Mirrors the `streamChat` golden rule — nothing here throws to its caller.
 * Every failure lands in `status: 'error'` with a message we authored.
 */
export class UpdaterService {
  private state: UpdateState
  private readonly backend: UpdaterBackend
  private readonly emit: (state: UpdateState) => void
  private readonly now: () => number
  private readonly persistEnabled: (enabled: boolean) => Promise<void>
  private firstCheckTimer: ReturnType<typeof setTimeout> | undefined
  private intervalTimer: ReturnType<typeof setInterval> | undefined

  constructor(options: UpdaterServiceOptions) {
    this.backend = options.backend
    this.emit = options.emit
    this.now = options.now ?? (() => Date.now())
    this.persistEnabled = options.persistEnabled ?? (async () => {})
    this.state = {
      status: 'idle',
      canAutoInstall: options.canAutoInstall,
      currentVersion: options.currentVersion,
      enabled: options.enabled,
      manualCheck: false,
    }

    this.backend.on('progress', (payload) => {
      if (this.state.status !== 'downloading') return
      if (typeof payload === 'number') this.patch({ percent: Math.max(0, Math.min(100, payload)) })
    })
    this.backend.on('downloaded', () => this.patch({ status: 'ready', percent: 100 }))
    this.backend.on('error', (payload) => this.fail(payload))
  }

  getState(): UpdateState {
    return { ...this.state }
  }

  start(): void {
    if (!this.state.enabled) return
    this.stop()
    // Delayed rather than immediate: a cold start must never wait on the network.
    this.firstCheckTimer = setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS)
    this.intervalTimer = setInterval(() => void this.check(), CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (this.firstCheckTimer) clearTimeout(this.firstCheckTimer)
    if (this.intervalTimer) clearInterval(this.intervalTimer)
    this.firstCheckTimer = undefined
    this.intervalTimer = undefined
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.patch({ enabled })
    await this.persistEnabled(enabled)
    if (enabled) this.start()
    else this.stop()
  }

  /**
   * @param manual true when the user pressed "Check now". A manual check runs
   * even while auto-checks are disabled, and marks the state so the chip may
   * surface a failure the user explicitly asked for.
   */
  async check(manual = false): Promise<void> {
    if (!this.state.enabled && !manual) return
    // A second check while one is in flight would double-download.
    if (this.state.status === 'checking' || this.state.status === 'downloading') return

    this.patch({ status: 'checking', manualCheck: manual, message: undefined })
    try {
      const result = await this.backend.check()
      this.patch({ lastCheckedAt: this.now() })

      if (!result || !isNewerVersion(this.state.currentVersion, result.version)) {
        this.patch({ status: 'idle', latestVersion: undefined })
        return
      }

      this.patch({
        status: 'available',
        latestVersion: result.version,
        releaseUrl: releaseUrlFor(result.version),
      })

      // macOS stops here: unsigned builds cannot be auto-installed, so the UI
      // links to the release page instead.
      if (!this.state.canAutoInstall) return

      this.patch({ status: 'downloading', percent: 0 })
      await this.backend.download()
    } catch (err) {
      this.fail(err)
    }
  }

  install(): void {
    if (this.state.status !== 'ready') return
    try {
      this.backend.quitAndInstall()
    } catch (err) {
      this.fail(err)
    }
  }

  private patch(partial: Partial<UpdateState>): void {
    this.state = { ...this.state, ...partial }
    this.emit(this.getState())
  }

  private fail(err: unknown): void {
    this.patch({ status: 'error', message: updateErrorMessage(err) })
  }
}
