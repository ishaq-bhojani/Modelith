import { useAppStore } from '../../state/store.js'
import type { UpdateState } from '@shared/types'
import { PanelHead } from '../PanelHead.js'
import { Switch } from '../../app/Switch.js'
import { IconUpdate } from '../../app/icons.js'

// Single source of truth for the manual-install sentence — referenced by
// every branch below that needs it, so a branch can no longer silently omit
// or diverge from it (as happened when the `error` case was rewritten
// without it during an earlier fix). Unlike the previous version of this
// file, it is only ever concatenated into rendered text from ONE place
// (`statusExplanation`), not repeated inline across four switch branches.
const MANUAL_INSTALL_NOTE =
  'This build cannot install updates automatically; download new versions manually from the release page.'

/** The version/availability half of the status sentence — never the macOS
 *  caveat. This is what a headline names, or (for statuses with no state
 *  block) the whole of `updates-status`. */
function statusHeadline(update: UpdateState | null): string {
  if (!update) return ''
  switch (update.status) {
    case 'error':
      return update.message ?? 'Update check failed.'
    case 'ready':
      return `Version ${update.latestVersion ?? ''} is ready — restart to install.`
    case 'downloading':
      // electron-updater reports a raw float (90.35480160960444), so format
      // it — the unrounded value spills across the status line.
      return `Downloading… ${(update.percent ?? 0).toFixed(2)}%`
    case 'checking':
      return 'Checking…'
    case 'available':
      return `Version ${update.latestVersion ?? ''} is available.`
    default:
      return 'Up to date.'
  }
}

/** The macOS caveat, standing alone — empty when it does not apply.
 *
 *  `downloading` and `ready` must NEVER carry it: reaching either already
 *  means a build was (or is being) fetched, so telling the user the platform
 *  "cannot install automatically" in the same breath would contradict the
 *  headline sitting right next to it. That contradiction was fixed across
 *  two earlier review rounds — do not reintroduce it here. */
function statusExplanation(update: UpdateState | null): string {
  if (!update) return ''
  if (update.status === 'downloading' || update.status === 'ready') return ''
  return update.canAutoInstall ? '' : MANUAL_INSTALL_NOTE
}

/** Small and local on purpose — the only relative time this file ever needs
 *  is "how long since the last check", so a dependency (or a generic
 *  Intl.RelativeTimeFormat abstraction) would be more code than it saves. */
function formatLastChecked(lastCheckedAt: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - lastCheckedAt) / 60000))
  if (minutes < 1) return 'checked just now'
  if (minutes === 1) return 'checked 1 minute ago'
  if (minutes < 60) return `checked ${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours === 1) return 'checked 1 hour ago'
  if (hours < 24) return `checked ${hours} hours ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'checked 1 day ago' : `checked ${days} days ago`
}

export function UpdatesPanel(): React.JSX.Element {
  const update = useAppStore((s) => s.update)

  // Only when there is something to act on. Both cases call the same bridge
  // method: main decides whether that installs or opens the release page, so
  // the renderer never handles a release URL.
  //
  // The 'ready' branch requires `canAutoInstall` too, not just the status:
  // main's `resolveInstallAction` only ever returns `{ type: 'install' }`
  // when `canAutoInstall` is true (see src/main/updater/policy.ts) — on a
  // platform that cannot auto-install, main routes even a hypothetical
  // 'ready' state to `shell.openExternal` instead. `ready` + `!canAutoInstall`
  // is unreachable today (service.ts returns before downloading on such a
  // platform), but the label must not claim "Restart to install" for a click
  // that would actually open the release page.
  const installLabel =
    update?.status === 'ready' && update.canAutoInstall ? 'Restart to install'
      : update?.status === 'available' && !update.canAutoInstall ? 'Download'
        : null

  // The state block is the "something to act on" surface: the headline says
  // what is happening, the explanation carries the macOS caveat (once, not
  // smeared across the sentence), and the install/download action sits
  // inside the same block instead of a disconnected row at the panel's foot.
  // An error only earns it when the user asked for the check — mirrors
  // UpdateChip's identical `manualCheck` gate, so a background failure stays
  // as quiet here as it does in the sidebar.
  const showStateBlock =
    update !== null
    && (update.status === 'available' || update.status === 'ready' || (update.status === 'error' && update.manualCheck))

  const lastChecked = update?.lastCheckedAt !== undefined
    ? formatLastChecked(update.lastCheckedAt, Date.now())
    : null

  return (
    <>
      <PanelHead title="Updates">
        An anonymous GET to the public GitHub API on launch and every six hours. No
        identifiers, nothing about your conversations.
      </PanelHead>

      <div className="updates-version-card">
        <div className="updates-version-info">
          <span className="updates-version-name" data-testid="updates-version">
            Modelith {update?.currentVersion ?? ''}
          </span>
          {lastChecked ? <span className="updates-version-meta">{lastChecked}</span> : null}
        </div>
        <button
          type="button"
          className="button-secondary"
          data-testid="updates-check-now"
          onClick={() => void window.modelith.updates.check()}
        >
          Check now
        </button>
      </div>

      {showStateBlock && update ? (
        <div
          className={`updates-state-block${update.status === 'available' || update.status === 'ready' ? ' is-accent' : ''}`}
        >
          <IconUpdate size={16} />
          <div className="updates-state-text" data-testid="updates-status">
            <p className="updates-state-headline" data-testid="update-headline">{statusHeadline(update)}</p>
            {statusExplanation(update) ? (
              <p className="updates-state-explanation" data-testid="update-explanation">
                {statusExplanation(update)}
              </p>
            ) : null}
          </div>
          {installLabel ? (
            <button
              type="button"
              className="button-compact"
              data-testid="updates-install"
              onClick={() => void window.modelith.updates.install()}
            >
              {installLabel}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="field-hint" data-testid="updates-status">
          {statusHeadline(update)}
          {statusExplanation(update) ? ` ${statusExplanation(update)}` : ''}
        </p>
      )}

      <div className="updates-toggle-row">
        <div className="updates-toggle-text">
          <span className="updates-toggle-label">Check automatically</span>
          <span className="updates-toggle-hint">On launch, then every six hours.</span>
        </div>
        <Switch
          checked={update?.enabled ?? true}
          onChange={(next) => void window.modelith.updates.setEnabled(next)}
          label="Check automatically"
          testId="updates-toggle"
        />
      </div>
    </>
  )
}
