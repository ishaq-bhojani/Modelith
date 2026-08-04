import { useEffect, useState } from 'react'
import { useAppStore } from '../../state/store.js'
import type { ModelInfo, ProviderSummary } from '@shared/types'
import { PanelHead } from '../PanelHead.js'

/** Fallback provider + model. Independent of the primary provider's config. */
export function FailoverPanel({ providers }: { providers: ProviderSummary[] }): React.JSX.Element {
  const providerId = useAppStore((s) => s.providerId)
  const fallbacks = useAppStore((s) => s.fallbacks)
  const setFallbacks = useAppStore((s) => s.setFallbacks)

  const [fallbackModels, setFallbackModels] = useState<ModelInfo[]>([])
  const fallback = fallbacks[0]

  // When a fallback provider is chosen, fetch its models so a concrete model
  // can be paired with it (the engine needs both).
  useEffect(() => {
    if (!fallback) { setFallbackModels([]); return }
    void window.modelith.providers.models(fallback.providerId)
      .then(setFallbackModels)
      .catch(() => setFallbackModels([]))
  }, [fallback?.providerId, fallback])

  return (
    <>
      <PanelHead title="Failover">
        If the primary provider hits a rate limit or is unavailable before any text
        arrives, the turn retries here automatically.
      </PanelHead>

      <div className="field">
        <label htmlFor="fallback-provider">Fallback provider (optional)</label>
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
      </div>
    </>
  )
}
