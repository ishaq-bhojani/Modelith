import { useAppStore } from '../state/store.js'

export function Sidebar(): React.JSX.Element {
  const sessions = useAppStore((s) => s.sessions)
  const activeId = useAppStore((s) => s.activeSessionId)
  const select = useAppStore((s) => s.selectSession)
  const create = useAppStore((s) => s.newSession)

  return (
    <aside data-testid="sidebar" className="sidebar">
      <button data-testid="new-session" onClick={() => void create()}>New chat</button>
      <ul>
        {sessions.map((s) => (
          <li key={s.id}>
            <button
              aria-current={s.id === activeId}
              onClick={() => void select(s.id)}
            >{s.title}</button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
