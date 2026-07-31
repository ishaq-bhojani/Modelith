import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../state/store.js'
import { modKey } from './shortcut.js'
import {
  IconDotsVertical,
  IconFolder,
  IconInfo,
  IconLogout,
  IconPlus,
  IconSliders,
} from './icons.js'

/**
 * The ⋯ app menu (design "Windows 11 — frameless titlebar"). The frameless
 * window has no visible OS menu strip, so the File/Window actions fold into
 * this button. Keyboard accelerators for the same actions still fire via the
 * hidden Electron menu (see main/window/controls.ts); this is the pointer path.
 *
 * Only actions that map to shipped behaviour are listed. "New window" and
 * "Export chat…" from the design are intentionally omitted — multi-window and
 * export are not built yet, and a menu item that does nothing is worse than its
 * absence.
 */
export function AppMenu(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const newSession = useAppStore((s) => s.newSession)
  const openSettings = useAppStore((s) => s.openSettings)
  const mod = modKey(useAppStore((s) => s.platform))

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

  const run = (fn: () => void | Promise<void>) => () => { setOpen(false); void fn() }

  return (
    <div className="app-menu" ref={rootRef}>
      <button
        className="icon-button"
        data-testid="app-menu-button"
        title="Menu"
        aria-label="Application menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconDotsVertical size={17} />
      </button>

      {open ? (
        <div className="app-menu-dropdown" role="menu" data-testid="app-menu-dropdown">
          <button className="app-menu-item" role="menuitem" onClick={run(newSession)}>
            <IconPlus size={15} />
            <span>New chat</span>
            <kbd>{mod}N</kbd>
          </button>
          <button
            className="app-menu-item"
            role="menuitem"
            onClick={run(() => window.openCoder.window.openChatsFolder())}
          >
            <IconFolder size={15} />
            <span>Open chats folder…</span>
          </button>

          <span className="app-menu-sep" />

          <button className="app-menu-item" role="menuitem" onClick={run(openSettings)}>
            <IconSliders size={15} />
            <span>Settings</span>
            <kbd>{mod},</kbd>
          </button>
          <button
            className="app-menu-item"
            role="menuitem"
            onClick={run(() => window.openCoder.window.about())}
          >
            <IconInfo size={15} />
            <span>About Open Coder</span>
          </button>

          <span className="app-menu-sep" />

          <button
            className="app-menu-item app-menu-item-danger"
            role="menuitem"
            onClick={run(() => window.openCoder.window.quit())}
          >
            <IconLogout size={15} />
            <span>Quit Open Coder</span>
            <kbd>{mod}Q</kbd>
          </button>
        </div>
      ) : null}
    </div>
  )
}
