import { useEffect, useState } from 'react'
import { useAppStore } from '../state/store.js'
import type { ModelInfo } from '@shared/types'

export function SettingsDialog(): React.JSX.Element | null {
  const open = useAppStore((s) => s.settingsOpen)
  const close = useAppStore((s) => s.closeSettings)
  const reportError = useAppStore((s) => s.reportError)
  const providerId = useAppStore((s) => s.providerId)
  const setProvider = useAppStore((s) => s.setProvider)
  const model = useAppStore((s) => s.model)
  const setModel = useAppStore((s) => s.setModel)

  const [providers, setProviders] = useState<{ id: string; label: string }[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [draftKey, setDraftKey] = useState('')
  const [configured, setConfigured] = useState(false)

  useEffect(() => {
    if (open) void window.openCoder.providers.list().then(setProviders).catch(reportError)
  }, [open, reportError])

  // Re-queries key status and the model list whenever the selected provider
  // changes (not only on open) — switching providers in the dialog must
  // immediately reflect that provider's own key/model state, never the
  // previous provider's stale values.
  useEffect(() => {
    if (!open) return
    void window.openCoder.keys.has(providerId).then(setConfigured).catch(reportError)
    void window.openCoder.providers.models(providerId).then((list) => {
      setModels(list)
      // `setProvider` resets `model` to '' (store.ts). Auto-selecting the
      // first available model on the happy path (a keyless provider, or one
      // whose key is already stored) means a user who just switches
      // providers and clicks Done never ends up sending with an empty
      // model string. If the provider has no models available yet (e.g. no
      // key stored), `model` stays '' and send()'s client-side `no_model`
      // guard (store.ts) reports an intelligible error instead of the
      // request ever reaching main's zod schema as an empty string.
      const first = list[0]
      if (first && !list.some((m) => m.id === model)) setModel(first.id)
    }).catch((err) => { setModels([]); reportError(err) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, open])

  if (!open) return null

  const save = async () => {
    try {
      await window.openCoder.keys.set(providerId, draftKey)
      setDraftKey('')
      setConfigured(await window.openCoder.keys.has(providerId))
      setModels(await window.openCoder.providers.models(providerId).catch(() => []))
    } catch (err) {
      // `Keystore.set` genuinely throws when the OS keychain is unavailable
      // (e.g. Electron's `safeStorage.isEncryptionAvailable()` is false, as
      // on a Linux box with no keyring running) — the user must see why the
      // save failed rather than watch the status silently stay "Not
      // configured" with no feedback at all.
      reportError(err)
    }
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-label="Settings">
      <div className="dialog">
        <h2>Settings</h2>

        <label htmlFor="provider">Provider</label>
        <select
          id="provider" data-testid="provider-select" value={providerId}
          onChange={(e) => setProvider(e.target.value)}
        >
          {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>

        <label htmlFor="apikey">API key</label>
        <input
          id="apikey" data-testid="api-key-input" type="password" value={draftKey}
          placeholder={configured ? 'A key is stored. Enter a new one to replace it.' : 'Paste your key'}
          onChange={(e) => setDraftKey(e.target.value)}
        />
        <span data-testid="key-status">{configured ? 'Configured' : 'Not configured'}</span>
        <button data-testid="api-key-save" disabled={draftKey.length === 0} onClick={() => void save()}>
          Save key
        </button>
        <button
          data-testid="api-key-delete"
          disabled={!configured}
          onClick={() => void window.openCoder.keys.delete(providerId)
            .then(() => setConfigured(false))
            .catch(reportError)}
        >Remove key</button>

        <label htmlFor="model">Model</label>
        <select id="model" data-testid="model-select" value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">Select a model</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>

        <button data-testid="settings-close" onClick={close}>Done</button>
      </div>
    </div>
  )
}
