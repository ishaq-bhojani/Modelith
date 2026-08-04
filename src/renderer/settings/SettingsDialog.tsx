import { useEffect, useState } from 'react'
import { useAppStore } from '../state/store.js'
import type { ProviderSummary } from '@shared/types'
import { useEscapeToClose } from '../app/useEscapeToClose.js'
import { ProviderPanel } from './panels/ProviderPanel.js'
import { FailoverPanel } from './panels/FailoverPanel.js'
import { ModesPanel } from './panels/ModesPanel.js'
import { UpdatesPanel } from './panels/UpdatesPanel.js'

type CategoryId = 'provider' | 'failover' | 'modes' | 'updates'

const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: 'provider', label: 'Provider' },
  { id: 'failover', label: 'Failover' },
  { id: 'modes', label: 'Modes' },
  { id: 'updates', label: 'Updates' },
]

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
  const [category, setCategory] = useState<CategoryId>('provider')

  useEffect(() => {
    if (open) void window.modelith.providers.list().then(setProviders).catch(reportError)
  }, [open, reportError])

  useEscapeToClose(open, close)

  if (!open) return null

  return (
    <div className="dialog-backdrop" role="dialog" aria-labelledby="settings-title" aria-modal="true" onClick={close}>
      <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head settings-head">
          <h2 id="settings-title">Settings</h2>
          <button className="icon-button" data-testid="settings-close-x" aria-label="Close settings" onClick={close}>✕</button>
        </div>

        <div className="settings-body">
          <div className="settings-rail" role="tablist" aria-orientation="vertical">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                role="tab"
                id={`settings-tab-${c.id}`}
                data-testid={`settings-tab-${c.id}`}
                className={`settings-rail-item${category === c.id ? ' is-active' : ''}`}
                aria-selected={category === c.id}
                // Only the ACTIVE panel is mounted, so pointing the other tabs
                // at element ids that do not exist would be worse than omitting
                // aria-controls entirely.
                {...(category === c.id ? { 'aria-controls': 'settings-panel' } : {})}
                onClick={() => setCategory(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div
            className="settings-panel"
            id="settings-panel"
            data-testid="settings-panel"
            role="tabpanel"
            aria-labelledby={`settings-tab-${category}`}
          >
            {category === 'provider' ? (
              <ProviderPanel providers={providers} draftKey={draftKey} setDraftKey={setDraftKey} />
            ) : null}
            {category === 'failover' ? <FailoverPanel providers={providers} /> : null}
            {category === 'modes' ? <ModesPanel /> : null}
            {category === 'updates' ? <UpdatesPanel /> : null}
          </div>
        </div>

        <div className="dialog-actions settings-foot">
          <span className="dialog-spacer" />
          <button className="button-compact" data-testid="settings-close" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  )
}
