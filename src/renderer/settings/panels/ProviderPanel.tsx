import { useEffect, useRef } from 'react'
import { useAppStore } from '../../state/store.js'
import type { ModelInfo, ProviderSummary } from '@shared/types'
import { IconCheck, IconLock } from '../../app/icons.js'
import { DataPolicyBadge } from '../../app/DataPolicyBadge.js'

/**
 * Provider, API key and Model — one flow: pick a provider, authenticate,
 * choose a model. `draftKey`, `models` and `configured` are owned by the
 * shell (SettingsDialog) so a half-typed key survives switching category and
 * back, and so the model list / key-configured flag are not re-fetched (and
 * flashed as stale) on every remount of this panel.
 */
export function ProviderPanel({
  providers, draftKey, setDraftKey, models, setModels, configured, setConfigured, autoFocus, onProviderFocused,
}: {
  providers: ProviderSummary[]
  draftKey: string
  setDraftKey: (v: string) => void
  models: ModelInfo[]
  setModels: (v: ModelInfo[]) => void
  configured: boolean
  setConfigured: (v: boolean) => void
  /** True while the Provider select still needs to claim focus for this dialog "open" session. */
  autoFocus: boolean
  /** Called once this panel has applied the pending auto-focus, so the shell can stop offering it. */
  onProviderFocused: () => void
}): React.JSX.Element {
  const reportError = useAppStore((s) => s.reportError)
  const providerId = useAppStore((s) => s.providerId)
  const setProvider = useAppStore((s) => s.setProvider)
  const model = useAppStore((s) => s.model)
  const setModel = useAppStore((s) => s.setModel)

  const selectRef = useRef<HTMLSelectElement>(null)

  const selectedProvider = providers.find((p) => p.id === providerId)

  // Fires once per mount (empty deps), mirroring native HTML `autoFocus` —
  // but unlike `autoFocus`, it only actually focuses when the shell says
  // focus is still pending for this dialog "open" session. Without the
  // `autoFocus` prop gate, returning to this tab on a later switch would
  // steal focus back from wherever the keyboard user had since moved
  // (Finding 3: Shift+Tab would walk out of the dialog instead of to the rail).
  useEffect(() => {
    if (autoFocus) {
      selectRef.current?.focus()
      onProviderFocused()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = async () => {
    try {
      await window.modelith.keys.set(providerId, draftKey)
      setDraftKey('')
      setConfigured(await window.modelith.keys.has(providerId))
      setModels(await window.modelith.providers.models(providerId).catch(() => []))
    } catch (err) {
      // `Keystore.set` genuinely throws when the OS keychain is unavailable
      // (e.g. a Linux box with no keyring running) — the user must see why
      // rather than watch the status silently stay "Not configured".
      reportError(err)
    }
  }

  return (
    <>
      <div className="field">
        <label htmlFor="provider">Provider</label>
        <select
          id="provider" data-testid="provider-select" value={providerId} ref={selectRef}
          onChange={(e) => setProvider(e.target.value)}
        >
          {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {selectedProvider?.dataPolicy ? (
          <span className="field-policy">
            <DataPolicyBadge policy={selectedProvider.dataPolicy} />
            {selectedProvider.dataPolicy.url ? (
              <a href={selectedProvider.dataPolicy.url} target="_blank" rel="noreferrer">Policy</a>
            ) : null}
          </span>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="apikey">API key</label>
        <input
          id="apikey" data-testid="api-key-input" type="password" value={draftKey}
          placeholder={configured ? 'A key is stored. Enter a new one to replace it.' : 'Paste your key'}
          onChange={(e) => setDraftKey(e.target.value)}
        />
        <span className="key-status">
          {configured ? <IconCheck size={13} /> : <IconLock size={13} />}
          <span data-testid="key-status">{configured ? 'Configured' : 'Not configured'}</span>
        </span>
        <p className="field-hint">
          Stored with the OS keychain. The interface can set, replace and clear it, but can
          never read it back.
        </p>
        <div className="dialog-actions">
          <button
            className="button-compact"
            data-testid="api-key-save"
            disabled={draftKey.length === 0}
            onClick={() => void save()}
          >
            Save key
          </button>
          <button
            className="button-secondary"
            data-testid="api-key-delete"
            disabled={!configured}
            onClick={() => void window.modelith.keys.delete(providerId)
              .then(() => setConfigured(false))
              .catch(reportError)}
          >Remove key</button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="model">Model</label>
        <select id="model" data-testid="model-select" value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">Select a model</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        {models.length === 0 ? (
          <p className="field-hint">
            No models available yet. Providers that need a key list their models once one is
            stored.
          </p>
        ) : null}
      </div>
    </>
  )
}
