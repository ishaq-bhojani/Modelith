import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../state/store.js'
import type { ModelInfo, ProviderSummary } from '@shared/types'
import { PRICING } from '@shared/pricing'
import { IconCheck, IconKey, IconLock } from '../../app/icons.js'
import { DataPolicyBadge } from '../../app/DataPolicyBadge.js'
import { PanelHead } from '../PanelHead.js'

/** `200000` -> `'200k'`. Local models often report no context window at all
 *  (`ModelInfo.contextWindow` is optional in practice), so `undefined` and
 *  non-finite values render nothing rather than `'undefinedk'` or `'NaNk'`. */
function formatContextWindow(n: number | undefined): string | null {
  if (n === undefined || !Number.isFinite(n)) return null
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

/** `PRICING` has no entry for a model it does not know, and per the file's own
 *  comment that must never be papered over with a default — callers render
 *  nothing rather than guess. A zero-priced local runtime IS a known price
 *  (genuinely free), so it is only ever `null` here when the lookup misses. */
function formatPrice(providerId: string, model: string): string | null {
  const price = PRICING[`${providerId}:${model}`]
  if (!price) return null
  return `$${price.inputPerMTok.toFixed(2)} in · $${price.outputPerMTok.toFixed(2)} out /Mtok`
}

/**
 * Provider, API key and Model as one card: identity, key state and key entry
 * read as facts about a single object instead of three disconnected fields.
 * `draftKey`, `models` and `configured` are owned by the shell (SettingsDialog)
 * so a half-typed key survives switching category and back, and so the model
 * list / key-configured flag are not re-fetched (and flashed as stale) on
 * every remount of this panel.
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

  const [providerListOpen, setProviderListOpen] = useState(false)
  const changeRef = useRef<HTMLButtonElement>(null)

  const selectedProvider = providers.find((p) => p.id === providerId)
  const priceLabel = formatPrice(providerId, model)

  // Fires once per mount (empty deps), mirroring native HTML `autoFocus` —
  // but unlike `autoFocus`, it only actually focuses when the shell says
  // focus is still pending for this dialog "open" session. Without the
  // `autoFocus` prop gate, returning to this tab on a later switch would
  // steal focus back from wherever the keyboard user had since moved
  // (Finding 3: Shift+Tab would walk out of the dialog instead of to the rail).
  useEffect(() => {
    if (autoFocus) {
      changeRef.current?.focus()
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
      <PanelHead title="Provider & key">
        Pick where turns are sent. The key is written to the OS keychain by the main process —
        the interface can replace or clear it, never read it back.
      </PanelHead>

      <div className="provider-card">
        <div className="provider-card-row provider-card-identity">
          <span className="provider-monogram">{(selectedProvider?.label ?? providerId).charAt(0).toUpperCase()}</span>
          <div className="provider-card-info">
            <span className="provider-card-name">{selectedProvider?.label ?? providerId}</span>
            {selectedProvider?.dataPolicy ? (
              <span className="field-policy">
                <DataPolicyBadge policy={selectedProvider.dataPolicy} />
                {selectedProvider.dataPolicy.url ? (
                  <a href={selectedProvider.dataPolicy.url} target="_blank" rel="noreferrer">Policy</a>
                ) : null}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="button-secondary"
            data-testid="provider-select"
            aria-expanded={providerListOpen}
            ref={changeRef}
            onClick={() => setProviderListOpen((v) => !v)}
          >
            Change
          </button>
        </div>

        {providerListOpen ? (
          <div className="provider-card-row provider-card-list">
            {providers.map((p) => (
              <button
                key={p.id}
                type="button"
                className="model-option"
                data-testid="provider-option"
                onClick={() => { setProvider(p.id); setProviderListOpen(false) }}
              >
                <span className="model-option-check">{p.id === providerId ? <IconCheck size={13} /> : null}</span>
                <span className="model-option-label">{p.label}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className={`provider-card-row provider-key-state${configured ? ' is-configured' : ''}`}>
          {configured ? <IconCheck size={13} /> : <IconLock size={13} />}
          <span className="provider-key-state-label" data-testid="key-status">
            {configured ? 'Key stored in the keychain' : 'No key stored'}
          </span>
          <button
            type="button"
            className="button-secondary"
            data-testid="api-key-delete"
            disabled={!configured}
            onClick={() => void window.modelith.keys.delete(providerId)
              .then(() => setConfigured(false))
              .catch(reportError)}
          >
            Remove
          </button>
        </div>

        <div className="provider-card-row provider-key-entry">
          <IconKey size={14} />
          <input
            id="apikey"
            data-testid="api-key-input"
            type="password"
            value={draftKey}
            placeholder={configured ? 'Enter a new key to replace it' : 'Paste your key'}
            onChange={(e) => setDraftKey(e.target.value)}
          />
          <button
            type="button"
            className="button-compact"
            data-testid="api-key-save"
            disabled={draftKey.length === 0}
            onClick={() => void save()}
          >
            Replace
          </button>
        </div>
      </div>

      <div className="field">
        <div className="model-list-head">
          <label>Model</label>
          {priceLabel ? <span className="model-list-meta">{priceLabel}</span> : null}
        </div>
        <div className="model-list" data-testid="model-select" role="listbox" aria-label="Model">
          {models.length === 0 ? (
            <p className="field-hint">
              No models available yet. Providers that need a key list their models once one is
              stored.
            </p>
          ) : (
            models.map((m) => {
              const contextLabel = formatContextWindow(m.contextWindow)
              return (
                <button
                  key={m.id}
                  type="button"
                  className="model-option"
                  data-testid="model-option"
                  role="option"
                  aria-selected={m.id === model}
                  onClick={() => setModel(m.id)}
                >
                  <span className="model-option-check">{m.id === model ? <IconCheck size={13} /> : null}</span>
                  <span className="model-option-label">{m.label}</span>
                  {contextLabel ? <span className="model-list-meta">{contextLabel}</span> : null}
                </button>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
