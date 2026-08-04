import { useAppStore } from '../../state/store.js'
import type { UpdateState } from '@shared/types'

// Settings is the always-available surface for update state (unlike the
// sidebar chip, which stays deliberately silent for most of the lifecycle):
// every status gets a line here, including the macOS "cannot auto-install"
// explanation, so it must live inside `updates-status` itself rather than a
// separate paragraph the test never looks at.
// Single source of truth for the manual-install sentence — referenced by
// every branch below that needs it, so a branch can no longer silently omit
// or diverge from it (as happened when the `error` case was rewritten
// without it during an earlier fix).
const MANUAL_INSTALL_NOTE =
  'This build cannot install updates automatically; download new versions manually from the release page.'

function updateStatusText(update: UpdateState | null): string {
  if (!update) return ''
  switch (update.status) {
    case 'error':
      return update.canAutoInstall
        ? (update.message ?? 'Update check failed.')
        : `${update.message ?? 'Update check failed.'} ${MANUAL_INSTALL_NOTE}`
    case 'ready':
      // Reaching 'ready' already means a build was downloaded and is staged
      // to install — appending the manual-install sentence here would
      // contradict "restart to install" in the same breath.
      return `Version ${update.latestVersion ?? ''} is ready — restart to install.`
    case 'downloading':
      // Mid-download, telling the user to go download manually instead is
      // self-contradictory regardless of `canAutoInstall`.
      // electron-updater reports a raw float (90.35480160960444), so format
      // it — the unrounded value spills across the status line.
      return `Downloading… ${(update.percent ?? 0).toFixed(2)}%`
    case 'checking':
      return update.canAutoInstall
        ? 'Checking…'
        : `Checking… ${MANUAL_INSTALL_NOTE}`
    case 'available':
      return update.canAutoInstall
        ? `Version ${update.latestVersion ?? ''} is available.`
        : `Version ${update.latestVersion ?? ''} is available. ${MANUAL_INSTALL_NOTE}`
    default:
      return update.canAutoInstall
        ? 'Up to date.'
        : `Up to date. ${MANUAL_INSTALL_NOTE}`
  }
}

export function UpdatesPanel(): React.JSX.Element {
  const update = useAppStore((s) => s.update)

  // Only when there is something to act on. Both cases call the same bridge
  // method: main decides whether that installs or opens the release page, so
  // the renderer never handles a release URL.
  const installLabel =
    update?.status === 'ready' ? 'Restart to install'
      : update?.status === 'available' && !update.canAutoInstall ? 'Download'
        : null

  return (
    <div className="field">
      <label>Updates</label>
      <p className="field-hint" data-testid="updates-version">
        Modelith {update?.currentVersion ?? ''}
      </p>
      <label className="key-status">
        <input
          type="checkbox"
          data-testid="updates-toggle"
          checked={update?.enabled ?? true}
          onChange={(e) => void window.modelith.updates.setEnabled(e.target.checked)}
        />
        <span>Automatically check for updates</span>
      </label>
      <p className="field-hint" data-testid="updates-status">
        {updateStatusText(update)}
      </p>
      <div className="dialog-actions">
        {installLabel ? (
          <button
            className="button-compact"
            data-testid="updates-install"
            onClick={() => void window.modelith.updates.install()}
          >
            {installLabel}
          </button>
        ) : null}
        <button
          className="button-secondary"
          data-testid="updates-check-now"
          onClick={() => void window.modelith.updates.check()}
        >
          Check now
        </button>
      </div>
    </div>
  )
}
