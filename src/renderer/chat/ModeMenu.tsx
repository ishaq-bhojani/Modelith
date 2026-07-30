import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../state/store.js'
import { IconChevronDown } from '../app/icons.js'

/**
 * Compact mode picker for the composer (roadmap 24). Applying a mode switches
 * the model (if the mode names one) and rides its system prompt + temperature
 * on subsequent sends. Full create/edit lives in Settings.
 */
export function ModeMenu(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const modes = useAppStore((s) => s.modes)
  const activeModeId = useAppStore((s) => s.activeModeId)
  const setActiveMode = useAppStore((s) => s.setActiveMode)
  const openSettings = useAppStore((s) => s.openSettings)

  const active = modes.find((m) => m.id === activeModeId)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => { window.removeEventListener('mousedown', onDown) }
  }, [open])

  return (
    <div className="mode-menu" ref={rootRef}>
      <button
        className="chip-button"
        data-testid="mode-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {active ? active.name : 'Mode'}
        <IconChevronDown size={11} />
      </button>

      {open ? (
        <div className="mode-dropdown" role="menu" data-testid="mode-dropdown">
          <button
            className="mode-option"
            role="menuitemradio"
            aria-checked={activeModeId === null}
            onClick={() => { setActiveMode(null); setOpen(false) }}
          >
            No mode
          </button>
          {modes.map((m) => (
            <button
              key={m.id}
              className="mode-option"
              role="menuitemradio"
              aria-checked={m.id === activeModeId}
              onClick={() => { setActiveMode(m.id); setOpen(false) }}
            >
              {m.name}
            </button>
          ))}
          <button
            className="mode-dropdown-foot"
            onClick={() => { setOpen(false); openSettings() }}
          >
            {modes.length === 0 ? 'Create a mode in settings…' : 'Manage modes…'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
