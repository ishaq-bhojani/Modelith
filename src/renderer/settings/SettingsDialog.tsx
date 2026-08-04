import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../state/store.js'
import type { ModelInfo, ProviderSummary } from '@shared/types'
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
  const providerId = useAppStore((s) => s.providerId)
  const model = useAppStore((s) => s.model)
  const setModel = useAppStore((s) => s.setModel)

  // Owned here, not in ProviderPanel: two panels need the provider list, and
  // fetching it twice would double the IPC call.
  const [providers, setProviders] = useState<ProviderSummary[]>([])
  // Owned here so a half-typed API key survives switching category and back;
  // unmounting ProviderPanel would otherwise discard a pasted secret.
  const [draftKey, setDraftKey] = useState('')
  // Owned here for the same reason as `draftKey` above: a hand-typed mode
  // name and system prompt are user-authored text, strictly more painful to
  // lose than a pasted key. Unmounting ModesPanel on a category switch would
  // otherwise discard both silently, with no warning and no undo.
  const [modeName, setModeName] = useState('')
  const [modePrompt, setModePrompt] = useState('')
  // Owned here for the same reason as `providers` above, extended: `models`
  // and `configured` each cost an IPC round trip to rebuild. Leaving them in
  // ProviderPanel meant every category switch back to Provider re-fetched
  // both and flashed stale UI ("Not configured", the lock icon, the
  // disabled "Remove key" button) for the duration of the round trip, and
  // re-ran the auto-select-first-model branch below, silently overwriting a
  // user's deliberate empty-model selection.
  const [models, setModels] = useState<ModelInfo[]>([])
  const [configured, setConfigured] = useState(false)
  const [category, setCategory] = useState<CategoryId>('provider')
  // Tracks whether the Provider select still needs to claim focus for the
  // current dialog "open" session. Starts true; ProviderPanel consumes it
  // (via `onProviderFocused`) the first time it mounts while pending, so
  // returning to the Provider tab on a later switch does not steal focus
  // again — native HTML `autoFocus` would otherwise refire on every remount.
  const [providerFocusPending, setProviderFocusPending] = useState(true)

  useEffect(() => {
    if (open) void window.modelith.providers.list().then(setProviders).catch(reportError)
  }, [open, reportError])

  // Re-queries key status and the model list once per dialog open, and again
  // whenever the selected provider changes — switching providers must
  // immediately reflect that provider's own key/model state, never the
  // previous provider's stale values. Deliberately NOT keyed on `category`:
  // switching tabs back to Provider within the same open session must not
  // refetch (that was the Finding 4 flash).
  useEffect(() => {
    if (!open) return
    void window.modelith.keys.has(providerId).then(setConfigured).catch(reportError)
    void window.modelith.providers.models(providerId).then((list) => {
      setModels(list)
      // `setProvider` resets `model` to '' (store.ts). Auto-selecting the
      // first available model on the happy path means a user who just
      // switches providers and clicks Done never ends up sending with an
      // empty model string.
      const first = list[0]
      if (first && !list.some((m) => m.id === model)) setModel(first.id)
    }).catch((err) => { setModels([]); reportError(err) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, providerId])

  // Settings always reopens on Provider, not wherever the user last left it:
  // "Open settings" is the affordance error-recovery UI (auth errors, no
  // model selected) links to, and those fixes live on the Provider panel.
  // Reset only on the false->true transition, not "whenever open is true" —
  // the latter would fire on every render while open and make the rail
  // unusable (a click on another tab would immediately bounce back).
  const wasOpenRef = useRef(open)
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setCategory('provider')
      setProviderFocusPending(true)
    }
    wasOpenRef.current = open
  }, [open])

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
          {/* No aria-orientation: that attribute tells assistive tech Up/Down
              arrows navigate the tablist, which is not implemented (every
              tab is reachable with Tab alone, and that is enough — YAGNI). */}
          <div className="settings-rail" role="tablist">
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
              <ProviderPanel
                providers={providers}
                draftKey={draftKey}
                setDraftKey={setDraftKey}
                models={models}
                setModels={setModels}
                configured={configured}
                setConfigured={setConfigured}
                autoFocus={providerFocusPending}
                onProviderFocused={() => setProviderFocusPending(false)}
              />
            ) : null}
            {category === 'failover' ? <FailoverPanel providers={providers} /> : null}
            {category === 'modes' ? (
              <ModesPanel
                modeName={modeName}
                setModeName={setModeName}
                modePrompt={modePrompt}
                setModePrompt={setModePrompt}
              />
            ) : null}
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
