import { useEffect, useState } from 'react'
import { useAppStore } from '../state/store.js'
import type { ModelInfo, ProviderSummary, UpdateState } from '@shared/types'
import { IconCheck, IconLock } from '../app/icons.js'
import { useEscapeToClose } from '../app/useEscapeToClose.js'
import { DataPolicyBadge } from '../app/DataPolicyBadge.js'

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
      // to install (auto, or already fetched manually) — appending the
      // manual-install sentence here would contradict "restart to install"
      // in the same breath, so it never applies to this status.
      return `Version ${update.latestVersion ?? ''} is ready — restart to install.`
    case 'downloading':
      // Mid-download, telling the user to go download manually instead is
      // self-contradictory regardless of `canAutoInstall`, so this status
      // never carries the manual-install sentence either.
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

export function SettingsDialog(): React.JSX.Element | null {
  const open = useAppStore((s) => s.settingsOpen)
  const close = useAppStore((s) => s.closeSettings)
  const reportError = useAppStore((s) => s.reportError)
  const providerId = useAppStore((s) => s.providerId)
  const setProvider = useAppStore((s) => s.setProvider)
  const model = useAppStore((s) => s.model)
  const setModel = useAppStore((s) => s.setModel)
  const fallbacks = useAppStore((s) => s.fallbacks)
  const setFallbacks = useAppStore((s) => s.setFallbacks)
  const modes = useAppStore((s) => s.modes)
  const saveMode = useAppStore((s) => s.saveMode)
  const deleteMode = useAppStore((s) => s.deleteMode)
  const update = useAppStore((s) => s.update)

  const [providers, setProviders] = useState<ProviderSummary[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [draftKey, setDraftKey] = useState('')
  const [configured, setConfigured] = useState(false)
  const [fallbackModels, setFallbackModels] = useState<ModelInfo[]>([])
  const [modeName, setModeName] = useState('')
  const [modePrompt, setModePrompt] = useState('')

  const selectedProvider = providers.find((p) => p.id === providerId)
  const fallback = fallbacks[0]

  // When a fallback provider is chosen, fetch its models so a concrete model can
  // be paired with it (the engine needs both).
  useEffect(() => {
    if (!open || !fallback) { setFallbackModels([]); return }
    void window.modelith.providers.models(fallback.providerId)
      .then(setFallbackModels)
      .catch(() => setFallbackModels([]))
  }, [open, fallback?.providerId, fallback])

  useEffect(() => {
    if (open) void window.modelith.providers.list().then(setProviders).catch(reportError)
  }, [open, reportError])

  // Re-queries key status and the model list whenever the selected provider
  // changes (not only on open) — switching providers in the dialog must
  // immediately reflect that provider's own key/model state, never the
  // previous provider's stale values.
  useEffect(() => {
    if (!open) return
    void window.modelith.keys.has(providerId).then(setConfigured).catch(reportError)
    void window.modelith.providers.models(providerId).then((list) => {
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

  useEscapeToClose(open, close)

  if (!open) return null

  const save = async () => {
    try {
      await window.modelith.keys.set(providerId, draftKey)
      setDraftKey('')
      setConfigured(await window.modelith.keys.has(providerId))
      setModels(await window.modelith.providers.models(providerId).catch(() => []))
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
    <div className="dialog-backdrop" role="dialog" aria-labelledby="settings-title" aria-modal="true" onClick={close}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2 id="settings-title">Settings</h2>
          <button className="icon-button" data-testid="settings-close-x" aria-label="Close settings" onClick={close}>✕</button>
        </div>

        <div className="field">
          <label htmlFor="provider">Provider</label>
          <select
            id="provider" data-testid="provider-select" value={providerId} autoFocus
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

        <div className="field">
          <label htmlFor="fallback-provider">Failover (optional)</label>
          <div className="fallback-row">
            <select
              id="fallback-provider"
              data-testid="fallback-provider"
              value={fallback?.providerId ?? ''}
              onChange={(e) => {
                const pid = e.target.value
                if (!pid) { void setFallbacks([]); return }
                // Provisional until a model is chosen; the engine skips a
                // fallback whose model is empty, so this is harmless meanwhile.
                void setFallbacks([{ providerId: pid, model: '' }])
              }}
            >
              <option value="">No fallback</option>
              {providers
                .filter((p) => p.id !== providerId)
                .map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            {fallback ? (
              <select
                data-testid="fallback-model"
                value={fallback.model}
                onChange={(e) => void setFallbacks([{ providerId: fallback.providerId, model: e.target.value }])}
              >
                <option value="">Select a model</option>
                {fallbackModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            ) : null}
          </div>
          <p className="field-hint">
            If the primary provider hits a rate limit or is unavailable before any text
            arrives, the turn retries here automatically.
          </p>
        </div>

        <div className="field">
          <label>Modes</label>
          <p className="field-hint">
            Named presets. Applying one (from the composer) sets its system prompt and the
            current model for following turns.
          </p>
          {modes.length > 0 ? (
            <ul className="mode-list">
              {modes.map((m) => (
                <li key={m.id} className="mode-list-item">
                  <span className="mode-list-name">{m.name}</span>
                  <button
                    className="row-action row-action-danger"
                    data-testid="delete-mode"
                    aria-label={`Delete mode ${m.name}`}
                    onClick={() => void deleteMode(m.id)}
                  >✕</button>
                </li>
              ))}
            </ul>
          ) : null}
          <input
            data-testid="mode-name"
            placeholder="Mode name (e.g. Rust reviewer)"
            value={modeName}
            onChange={(e) => setModeName(e.target.value)}
          />
          <textarea
            className="mode-prompt"
            data-testid="mode-prompt"
            placeholder="System prompt"
            rows={3}
            value={modePrompt}
            onChange={(e) => setModePrompt(e.target.value)}
          />
          <button
            className="button-secondary"
            data-testid="mode-save"
            disabled={modeName.trim() === '' || modePrompt.trim() === ''}
            onClick={() => {
              void saveMode({
                id: `mode-${Date.now()}`,
                name: modeName.trim(),
                systemPrompt: modePrompt.trim(),
                providerId,
                model,
              })
              setModeName('')
              setModePrompt('')
            }}
          >
            Add mode (uses the current provider &amp; model)
          </button>
        </div>

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
            <button
              className="button-secondary"
              data-testid="updates-check-now"
              onClick={() => void window.modelith.updates.check()}
            >
              Check now
            </button>
          </div>
        </div>

        <div className="dialog-actions">
          <span className="dialog-spacer" />
          <button className="button-compact" data-testid="settings-close" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  )
}
