import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../state/store.js'
import type { ModelInfo } from '@shared/types'
import { DataPolicyBadge } from './DataPolicyBadge.js'
import { IconCheck, IconChevronDown } from './icons.js'

/**
 * Header model picker (roadmap 2): switch model mid-conversation without opening
 * Settings. Lists the current provider's models; a "More in settings" footer
 * handles the rarer provider switch. Shows the current provider's data policy up
 * front so the choice is informed.
 */
export function ModelPicker(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const providerId = useAppStore((s) => s.providerId)
  const providers = useAppStore((s) => s.providers)
  const model = useAppStore((s) => s.model)
  const setModel = useAppStore((s) => s.setModel)
  const openSettings = useAppStore((s) => s.openSettings)

  const provider = providers.find((p) => p.id === providerId)
  const label = model ? `${provider?.label ?? providerId} · ${model}` : 'Choose a model'

  useEffect(() => {
    if (!open) return
    setLoading(true)
    let cancelled = false
    void window.modelith.providers
      .models(providerId)
      .then((list) => { if (!cancelled) setModels(list) })
      .catch(() => { if (!cancelled) setModels([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, providerId])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        className="pill-button"
        data-testid="model-pill"
        title="Change model"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="pill-dot" />
        <span className="pill-label">{label}</span>
        <IconChevronDown size={12} />
      </button>

      {open ? (
        <div className="model-dropdown" role="menu" data-testid="model-dropdown">
          {provider ? (
            <div className="model-dropdown-head">
              <span className="model-dropdown-provider">{provider.label}</span>
              <DataPolicyBadge policy={provider.dataPolicy} />
            </div>
          ) : null}

          <div className="model-dropdown-list">
            {loading ? (
              <div className="model-dropdown-empty">Loading models…</div>
            ) : models.length === 0 ? (
              <div className="model-dropdown-empty">
                No models available. Add a key in settings.
              </div>
            ) : (
              models.map((m) => (
                <button
                  key={m.id}
                  className="model-option"
                  role="menuitemradio"
                  aria-checked={m.id === model}
                  onClick={() => { setModel(m.id); setOpen(false) }}
                >
                  <span className="model-option-check">{m.id === model ? <IconCheck size={13} /> : null}</span>
                  <span className="model-option-label">{m.label}</span>
                </button>
              ))
            )}
          </div>

          <button
            className="model-dropdown-foot"
            onClick={() => { setOpen(false); openSettings() }}
          >
            Change provider or key in settings…
          </button>
        </div>
      ) : null}
    </div>
  )
}
