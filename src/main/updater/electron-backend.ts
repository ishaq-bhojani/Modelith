// electron-updater is CommonJS; this project is ESM ("type": "module"), so the
// named export cannot be destructured from a static import. Import the default
// and pull `autoUpdater` off it.
import electronUpdater from 'electron-updater'
import type { UpdateCheckResult, UpdaterBackend, UpdaterBackendEvent } from './backend.js'
import { normalizeVersion } from './policy.js'

const { autoUpdater } = electronUpdater

/**
 * Windows (NSIS) and Linux (AppImage). Thin on purpose — everything that could
 * hold a bug lives in service.ts or policy.ts, both of which are unit-tested.
 *
 * electron-updater verifies the download's SHA512 against the signed
 * latest*.yml metadata published beside the installers. That verification is
 * the reason this dependency exists rather than a hand-rolled downloader.
 */
export class ElectronUpdaterBackend implements UpdaterBackend {
  constructor() {
    // We drive downloading from the service so the UI can show `available`
    // before bytes start moving.
    autoUpdater.autoDownload = false
    // A user who ignores the chip still gets the update on their next normal
    // quit — no second prompt, no lost download.
    autoUpdater.autoInstallOnAppQuit = true
  }

  async check(): Promise<UpdateCheckResult | null> {
    const result = await autoUpdater.checkForUpdates()
    const version = result?.updateInfo?.version
    if (typeof version !== 'string' || version.length === 0) return null
    return { version: normalizeVersion(version) }
  }

  async download(): Promise<void> {
    await autoUpdater.downloadUpdate()
  }

  quitAndInstall(): void {
    autoUpdater.quitAndInstall()
  }

  on(event: UpdaterBackendEvent, cb: (payload: unknown) => void): void {
    if (event === 'progress') {
      autoUpdater.on('download-progress', (info: { percent?: number }) => cb(info?.percent ?? 0))
      return
    }
    if (event === 'downloaded') {
      autoUpdater.on('update-downloaded', () => cb(undefined))
      return
    }
    autoUpdater.on('error', (err: unknown) => cb(err))
  }
}
