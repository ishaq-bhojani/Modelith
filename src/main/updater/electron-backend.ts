// electron-updater is CommonJS; this project is ESM ("type": "module"), so the
// named export cannot be destructured from a static import. Import the default
// and pull `autoUpdater` off it — lazily (see getAutoUpdater below).
import electronUpdater from 'electron-updater'
import type { UpdateCheckResult, UpdaterBackend, UpdaterBackendEvent } from './backend.js'
import { normalizeVersion } from './policy.js'

// electron-updater exposes `autoUpdater` as a getter that constructs the
// platform-specific updater (NsisUpdater/MacUpdater/AppImageUpdater) the first
// time it is READ, and that construction touches Electron's real `app` (e.g.
// `app.getVersion()`). Destructuring it at module scope, as one might expect,
// would trigger that construction the instant this module is imported — and
// handlers.ts imports it statically (required so Rollup bundles it for
// packaged builds; see backend.ts's selectBackend doc comment). A unit test
// that imports handlers.ts for unrelated reasons (e.g.
// tests/unit/ipc-zod-mapping.test.ts, which only wants withZodMapping) has no
// real Electron `app`, so that eager construction throws. Reading the getter
// lazily, only from inside the methods below, means merely importing this
// file has no Electron-runtime side effect — the getter only fires once
// `new ElectronUpdaterBackend()` actually runs, which only happens inside a
// packaged app (see selectBackend in backend.ts).
function getAutoUpdater(): (typeof electronUpdater)['autoUpdater'] {
  return electronUpdater.autoUpdater
}

/**
 * Windows (NSIS) and Linux (AppImage). Thin on purpose — everything that could
 * hold a bug lives in service.ts or policy.ts, both of which are unit-tested.
 *
 * electron-updater verifies the download's SHA512 against the signed
 * latest*.yml metadata published beside the installers. That verification is
 * the reason this dependency exists rather than a hand-rolled downloader.
 */
export class ElectronUpdaterBackend implements UpdaterBackend {
  // Resolved once, here, at construction — not at module scope (see
  // getAutoUpdater above) — since construction only ever happens inside a
  // packaged app where the real Electron `app` exists.
  private readonly autoUpdater = getAutoUpdater()

  constructor() {
    // We drive downloading from the service so the UI can show `available`
    // before bytes start moving.
    this.autoUpdater.autoDownload = false
    // A user who ignores the chip still gets the update on their next normal
    // quit — no second prompt, no lost download.
    this.autoUpdater.autoInstallOnAppQuit = true
  }

  async check(): Promise<UpdateCheckResult | null> {
    // NOTE: on failure, electron-updater both emits 'error' on the
    // `autoUpdater` singleton (see the on() method below) AND rejects this
    // call's promise for the same failure. UpdaterService listens for
    // 'error' and also catches the rejection here, so one real failure calls
    // service.fail() twice. That's harmless — fail() is idempotent state —
    // just a wasted duplicate IPC send, not a bug to "fix" by suppressing
    // either path.
    const result = await this.autoUpdater.checkForUpdates()
    const version = result?.updateInfo?.version
    if (typeof version !== 'string' || version.length === 0) return null
    return { version: normalizeVersion(version) }
  }

  async download(): Promise<void> {
    await this.autoUpdater.downloadUpdate()
  }

  quitAndInstall(): void {
    this.autoUpdater.quitAndInstall()
  }

  on(event: UpdaterBackendEvent, cb: (payload: unknown) => void): void {
    if (event === 'progress') {
      this.autoUpdater.on('download-progress', (info: { percent?: number }) => cb(info?.percent ?? 0))
      return
    }
    if (event === 'downloaded') {
      this.autoUpdater.on('update-downloaded', () => cb(undefined))
      return
    }
    this.autoUpdater.on('error', (err: unknown) => cb(err))
  }
}
