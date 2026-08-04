import { useAppStore } from '../state/store.js'

/**
 * The quiet update indicator, rendered in the sidebar footer.
 *
 * Deliberately silent for most of the lifecycle: `checking` and `downloading`
 * render nothing, because an app people leave open mid-conversation should not
 * flicker status at them. A background failure is silent too — only a failure
 * the user asked for (via "Check now") is shown.
 */
export function UpdateChip(): React.JSX.Element | null {
  const update = useAppStore((s) => s.update)
  const dismissed = useAppStore((s) => s.updateChipDismissed)
  const dismiss = useAppStore((s) => s.dismissUpdateChip)

  if (!update || dismissed) return null

  const { status, canAutoInstall, latestVersion, manualCheck, message } = update

  const visible =
    status === 'ready' ||
    (status === 'available' && !canAutoInstall) ||
    (status === 'error' && manualCheck)
  if (!visible) return null

  const label =
    status === 'ready' ? 'Update ready'
      : status === 'available' ? `v${latestVersion ?? ''} available`
        : (message ?? 'Update check failed')

  const actionLabel = status === 'ready' ? 'Restart' : status === 'available' ? 'Download' : null

  return (
    <div className="update-chip" data-testid="update-chip">
      <span className="update-chip-label">{label}</span>
      {actionLabel ? (
        <button
          className="update-chip-action"
          data-testid="update-chip-action"
          onClick={() => void window.modelith.updates.install()}
        >
          {actionLabel}
        </button>
      ) : null}
      <button
        className="update-chip-dismiss"
        data-testid="update-chip-dismiss"
        title="Dismiss"
        aria-label="Dismiss"
        onClick={dismiss}
      >
        ×
      </button>
    </div>
  )
}
