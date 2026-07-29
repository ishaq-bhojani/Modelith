import { useEffect } from 'react'
import { useAppStore } from '../state/store.js'
import { Splitter } from './Splitter.js'
import { Sidebar } from '../sessions/Sidebar.js'
import { Transcript } from '../chat/Transcript.js'
import { Composer } from '../chat/Composer.js'
import { FirstRun } from '../chat/FirstRun.js'
import { SettingsDialog } from '../settings/SettingsDialog.js'
import { IconChevronDown } from './icons.js'

export function App(): React.JSX.Element {
  const sidebarWidth = useAppStore((s) => s.sidebarWidth)
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth)
  const loadSessions = useAppStore((s) => s.loadSessions)
  const loadProviders = useAppStore((s) => s.loadProviders)
  const applyEvent = useAppStore((s) => s.applyEvent)
  const theme = useAppStore((s) => s.theme)

  const sessions = useAppStore((s) => s.sessions)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const model = useAppStore((s) => s.model)
  const providerId = useAppStore((s) => s.providerId)
  const providers = useAppStore((s) => s.providers)
  const openSettings = useAppStore((s) => s.openSettings)

  useEffect(() => { void loadSessions() }, [loadSessions])
  useEffect(() => { void loadProviders() }, [loadProviders])
  useEffect(() => window.openCoder.chat.onEvent(applyEvent), [applyEvent])

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
  }, [theme])

  const activeTitle = sessions.find((s) => s.id === activeSessionId)?.title ?? 'Open Coder'
  const providerLabel = providers.find((p) => p.id === providerId)?.label ?? providerId
  const modelLabel = model ? `${providerLabel} · ${model}` : 'Choose a model'

  return (
    <div className="app" style={{ ['--sidebar-width' as string]: `${sidebarWidth}px` }}>
      <Sidebar />
      <Splitter width={sidebarWidth} onResize={setSidebarWidth} />

      <main className="chat">
        <header className="chat-head">
          <span className="chat-title">{activeTitle}</span>
          <button
            className="pill-button"
            data-testid="model-pill"
            title="Change provider or model"
            onClick={openSettings}
          >
            <span className="pill-dot" />
            <span className="pill-label">{modelLabel}</span>
            <IconChevronDown size={12} />
          </button>
        </header>

        {activeSessionId === null ? <FirstRun /> : <Transcript />}
        <Composer />
      </main>

      <SettingsDialog />
    </div>
  )
}
