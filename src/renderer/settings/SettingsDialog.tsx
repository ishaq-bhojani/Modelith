import { useEffect, useState } from 'react'
import { useAppStore } from '../state/store.js'
import type { ProviderSummary } from '@shared/types'
import { useEscapeToClose } from '../app/useEscapeToClose.js'
import { ProviderPanel } from './panels/ProviderPanel.js'
import { FailoverPanel } from './panels/FailoverPanel.js'
import { ModesPanel } from './panels/ModesPanel.js'
import { UpdatesPanel } from './panels/UpdatesPanel.js'

export function SettingsDialog(): React.JSX.Element | null {
  const open = useAppStore((s) => s.settingsOpen)
  const close = useAppStore((s) => s.closeSettings)
  const reportError = useAppStore((s) => s.reportError)

  // Owned here, not in ProviderPanel: two panels need the provider list, and
  // fetching it twice would double the IPC call.
  const [providers, setProviders] = useState<ProviderSummary[]>([])
  // Owned here so a half-typed API key survives switching category and back;
  // unmounting ProviderPanel would otherwise discard a pasted secret.
  const [draftKey, setDraftKey] = useState('')

  useEffect(() => {
    if (open) void window.modelith.providers.list().then(setProviders).catch(reportError)
  }, [open, reportError])

  useEscapeToClose(open, close)

  if (!open) return null

  return (
    <div className="dialog-backdrop" role="dialog" aria-labelledby="settings-title" aria-modal="true" onClick={close}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2 id="settings-title">Settings</h2>
          <button className="icon-button" data-testid="settings-close-x" aria-label="Close settings" onClick={close}>✕</button>
        </div>

        <ProviderPanel providers={providers} draftKey={draftKey} setDraftKey={setDraftKey} />
        <FailoverPanel providers={providers} />
        <ModesPanel />
        <UpdatesPanel />

        <div className="dialog-actions">
          <span className="dialog-spacer" />
          <button className="button-compact" data-testid="settings-close" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  )
}
