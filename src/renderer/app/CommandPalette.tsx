import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../state/store.js'

interface Command {
  id: string
  label: string
  hint?: string
  run(): void
}

/**
 * ⌘K command palette (roadmap 32): every action and every chat in one fuzzy
 * list. Opens on ⌘K/Ctrl+K or the forwarded menu accelerator. Keyboard-first —
 * the strongest argument for a desktop app over a browser tab.
 */
export function CommandPalette(): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)

  const sessions = useAppStore((s) => s.sessions)
  const newSession = useAppStore((s) => s.newSession)
  const openSettings = useAppStore((s) => s.openSettings)
  const selectSession = useAppStore((s) => s.selectSession)
  const setTheme = useAppStore((s) => s.setTheme)
  const theme = useAppStore((s) => s.theme)
  const toggleInspector = useAppStore((s) => s.toggleInspector)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    const offMenu = window.openCoder.onMenu('command-palette', () => setOpen(true))
    return () => { window.removeEventListener('keydown', onKey); offMenu() }
  }, [])

  useEffect(() => { if (open) { setQuery(''); setCursor(0) } }, [open])

  const commands = useMemo<Command[]>(() => {
    const actions: Command[] = [
      { id: 'new', label: 'New chat', hint: '⌘N', run: () => void newSession() },
      { id: 'settings', label: 'Open settings', hint: '⌘,', run: openSettings },
      { id: 'theme', label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`, run: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
      { id: 'inspect', label: 'Toggle context inspector', run: toggleInspector },
    ]
    const chats: Command[] = sessions.map((s) => ({
      id: `session:${s.id}`,
      label: s.title,
      hint: 'Chat',
      run: () => void selectSession(s.id),
    }))
    return [...actions, ...chats]
  }, [sessions, theme, newSession, openSettings, selectSession, setTheme, toggleInspector])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    // Subsequence fuzzy match: every query char appears in order.
    const matches = (label: string): boolean => {
      const l = label.toLowerCase()
      let i = 0
      for (const ch of l) { if (ch === q[i]) i++; if (i === q.length) return true }
      return i === q.length
    }
    return commands.filter((c) => matches(c.label))
  }, [commands, query])

  if (!open) return null

  const clampedCursor = Math.min(cursor, Math.max(0, filtered.length - 1))
  const runAt = (i: number) => {
    const cmd = filtered[i]
    if (cmd) { setOpen(false); cmd.run() }
  }

  return (
    <div className="palette-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="palette-input"
          data-testid="palette-input"
          autoFocus
          value={query}
          placeholder="Type a command or search chats…"
          onChange={(e) => { setQuery(e.target.value); setCursor(0) }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, filtered.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
            if (e.key === 'Enter') { e.preventDefault(); runAt(clampedCursor) }
          }}
        />
        <div className="palette-list" data-testid="palette-list">
          {filtered.length === 0 ? (
            <div className="palette-empty">No matches</div>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                className={`palette-item${i === clampedCursor ? ' palette-item-active' : ''}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => runAt(i)}
              >
                <span className="palette-item-label">{c.label}</span>
                {c.hint ? <span className="palette-item-hint">{c.hint}</span> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
