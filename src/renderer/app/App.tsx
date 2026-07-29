import { useEffect } from 'react'
import { useAppStore } from '../state/store.js'
import { Splitter } from './Splitter.js'
import { Sidebar } from '../sessions/Sidebar.js'

export function App(): React.JSX.Element {
  const sidebarWidth = useAppStore((s) => s.sidebarWidth)
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth)
  const loadSessions = useAppStore((s) => s.loadSessions)
  const applyEvent = useAppStore((s) => s.applyEvent)

  useEffect(() => { void loadSessions() }, [loadSessions])
  useEffect(() => window.openCoder.chat.onEvent(applyEvent), [applyEvent])

  return (
    <div className="app" style={{ ['--sidebar-width' as string]: `${sidebarWidth}px` }}>
      <Sidebar />
      <Splitter onResize={setSidebarWidth} />
      <main className="chat">
        {/* Placeholders. Task 10 replaces this block with <Transcript /> and <Composer />. */}
        <div data-testid="transcript" className="transcript" />
        <div className="composer">
          <textarea data-testid="composer-input" rows={3} placeholder="Ask anything" readOnly />
        </div>
      </main>
    </div>
  )
}
