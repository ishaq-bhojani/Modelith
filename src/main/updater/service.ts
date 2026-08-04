import type { UpdateState } from '../../shared/types.js'
import type { UpdaterBackend } from './backend.js'
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  isCheckDue,
  isNewerVersion,
  MANUAL_CHECK_MIN_INTERVAL_MS,
  releaseUrlFor,
  UpdateError,
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
    try {
      // Turning updates off must also stop an already-staged download from
      // installing itself on the next quit — not just stop future checks.
      // Without this, a user who disables updates after a download finished
      // (status: 'ready') gets updated anyway via electron-updater's own quit
      // hook, contradicting the explicit toggle. Re-enabling restores it.
      // Deliberately NOT called from dismissing the chip: a dismissed but
      // staged update installing on the user's next natural quit is the
      // intended behaviour, only this Settings toggle changes it.
      this.backend.setInstallOnQuit(enabled)
    } catch (err) {
      // A throwing backend here must never escape setEnabled — same
      // never-throws guarantee as everywhere else in this class.
      this.fail(err)
    }
    try {
      await this.persistEnabled(enabled)
    } catch (err) {
      // The in-memory toggle and timer (re)scheduling below must still take
      // effect even when the write to disk fails — only the failure itself
      // is surfaced, as state rather than a rejection that would cross IPC.
      this.fail(err)
    }
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

    // Background checks are already interval-paced (CHECK_INTERVAL_MS via
    // start()'s timer), so this throttle applies only to manual ones — a
    // renderer that calls updates:check in a loop (buggy UI, or a user
    // mashing "Check now") would otherwise hammer api.github.com with no
    // limit until GitHub rate-limits it. The interval here is far shorter
    // than the background cadence so a genuine "Check now" still feels
    // immediate. The user pressed a button and deserves feedback rather than
    // a silent no-op, so this reports a truthful (throttled) error state
    // instead of doing nothing.
    if (manual && !isCheckDue(this.state.lastCheckedAt, this.now(), MANUAL_CHECK_MIN_INTERVAL_MS)) {
      this.patch({ manualCheck: true })
      this.fail(new UpdateError('throttled'))
      return
    }

    this.patch({ status: 'checking', manualCheck: manual, message: undefined })
    try {
      const result = await this.backend.check()
      this.patch({ lastCheckedAt: this.now() })

      if (!result || !isNewerVersion(this.state.currentVersion, result.version)) {
        // Clear every field a prior cycle may have set — a stale releaseUrl
        // or percent surviving under status: 'idle' would be a ghost link/
        // progress bar for any renderer code that reads them without first
        // checking status.
        this.patch({ status: 'idle', latestVersion: undefined, releaseUrl: undefined, percent: undefined })
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
      // electron-updater's downloadUpdate() resolves once the download is
      // actually complete, and the fake/e2e backends may never emit a
      // separate 'downloaded' event at all. Without this, a backend that
      // resolves silently would park state in 'downloading' forever, and the
      // re-entrancy guard at the top of this method would then swallow every
      // future check — scheduled or manual — with no error and no recovery.
      // Only apply this when status is STILL 'downloading': a 'downloaded'
      // event may have already fired synchronously during the call above
      // (moving status to 'ready'), or an 'error' event may have arrived
      // (moving status to 'error') — neither may be clobbered here.
      //
      // Read through getState() rather than this.state directly: TS's
      // control-flow narrowing carries the early-return guard's exclusion of
      // 'checking'/'downloading' (line 102) through the several `this.patch`
      // calls above for the `this.state.status` expression specifically —
      // even though patch() reassigns `this.state` — so the direct property
      // read is (wrongly) narrowed to a type that already excludes
      // 'downloading' by this point. getState() returns a fresh object, so
      // its `.status` isn't tied to that stale narrowing.
      if (this.getState().status === 'downloading') {
        this.patch({ status: 'ready', percent: 100 })
      }
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
    try {
      this.emit(this.getState())
    } catch {
      // A throwing consumer (e.g. window.webContents.send after the
      // BrowserWindow was destroyed) must never propagate out of the state
      // machine — the state itself is already updated above regardless.
    }
  }

  private fail(err: unknown): void {
    this.patch({ status: 'error', message: updateErrorMessage(err) })
  }
}
