import { useEffect } from 'react'
import { useAppStore } from '../state/store.js'
import { Splitter } from './Splitter.js'
import { Sidebar } from '../sessions/Sidebar.js'
import { Transcript } from '../chat/Transcript.js'
import { Composer } from '../chat/Composer.js'
import { SettingsDialog } from '../settings/SettingsDialog.js'

export function App(): React.JSX.Element {
  const sidebarWidth = useAppStore((s) => s.sidebarWidth)
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth)
  const loadSessions = useAppStore((s) => s.loadSessions)
  const loadProviders = useAppStore((s) => s.loadProviders)
  const applyEvent = useAppStore((s) => s.applyEvent)

  useEffect(() => { void loadSessions() }, [loadSessions])
  useEffect(() => { void loadProviders() }, [loadProviders])
  useEffect(() => window.openCoder.chat.onEvent(applyEvent), [applyEvent])

  return (
    <div className="app" style={{ ['--sidebar-width' as string]: `${sidebarWidth}px` }}>
      <Sidebar />
      <Splitter width={sidebarWidth} onResize={setSidebarWidth} />
      <main className="chat">
        <Transcript />
        <Composer />
      </main>
      <SettingsDialog />
    </div>
  )
}
