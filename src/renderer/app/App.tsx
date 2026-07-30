import { useEffect } from 'react'
import { useAppStore } from '../state/store.js'
import { TitleBar } from './TitleBar.js'
import { Splitter } from './Splitter.js'
import { Sidebar } from '../sessions/Sidebar.js'
import { Transcript } from '../chat/Transcript.js'
import { Composer } from '../chat/Composer.js'
import { FirstRun } from '../chat/FirstRun.js'
import { SettingsDialog } from '../settings/SettingsDialog.js'
import { ContextInspector } from '../chat/ContextInspector.js'
import { WorkspacePanel } from '../chat/WorkspacePanel.js'
import { CanvasPane } from '../canvas/CanvasPane.js'
import { SideThread } from '../chat/SideThread.js'
import { SecretWarning } from '../chat/SecretWarning.js'
import { CommandPalette } from './CommandPalette.js'
import { ModelPicker } from './ModelPicker.js'
import { sessionCost, formatTotal } from '../chat/cost.js'
import { IconMoon, IconSideThread, IconSun } from './icons.js'

export function App(): React.JSX.Element {
  const sidebarWidth = useAppStore((s) => s.sidebarWidth)
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth)
  const loadSessions = useAppStore((s) => s.loadSessions)
  const loadProviders = useAppStore((s) => s.loadProviders)
  const loadPlatform = useAppStore((s) => s.loadPlatform)
  const loadSettings = useAppStore((s) => s.loadSettings)
  const initWorkspace = useAppStore((s) => s.initWorkspace)
  const applyEvent = useAppStore((s) => s.applyEvent)
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)

  const sessions = useAppStore((s) => s.sessions)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const messages = useAppStore((s) => s.messages)
  const openSettings = useAppStore((s) => s.openSettings)
  const newSession = useAppStore((s) => s.newSession)
  const openSideThread = useAppStore((s) => s.openSideThread)

  useEffect(() => { void loadSessions() }, [loadSessions])
  useEffect(() => { void loadProviders() }, [loadProviders])
  useEffect(() => { void loadPlatform() }, [loadPlatform])
  useEffect(() => { void loadSettings() }, [loadSettings])
  useEffect(() => { void initWorkspace() }, [initWorkspace])
  useEffect(() => window.openCoder.chat.onEvent(applyEvent), [applyEvent])

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
  }, [theme])

  // Keyboard accelerators forwarded from the (hidden) native menu, so shortcuts
  // fire even though the OS menu strip is gone. The palette/search actions are
  // wired in their own components; here we handle the two the shell owns.
  useEffect(() => {
    const offNew = window.openCoder.onMenu('new-chat', () => void newSession())
    const offSettings = window.openCoder.onMenu('settings', () => openSettings())
    return () => { offNew(); offSettings() }
  }, [newSession, openSettings])

  const activeTitle = sessions.find((s) => s.id === activeSessionId)?.title ?? 'Open Coder'
  const costTotal = formatTotal(sessionCost(messages))

  return (
    <div className="shell">
      <TitleBar />
      <div className="app" style={{ ['--sidebar-width' as string]: `${sidebarWidth}px` }}>
        <Sidebar />
        <Splitter width={sidebarWidth} onResize={setSidebarWidth} />

        <main className="chat">
          <header className="chat-head">
            <span className="chat-title">{activeTitle}</span>
            {costTotal ? (
              <span className="session-cost" title="Estimated cost of this session" data-testid="session-cost">
                {costTotal}
              </span>
            ) : null}
            <button
              className="icon-button"
              data-testid="side-thread-open"
              title="Open a side thread"
              aria-label="Open a side thread"
              onClick={() => openSideThread(window.getSelection?.()?.toString().trim() ?? '')}
            >
              <IconSideThread size={16} />
            </button>
            <button
              className="icon-button"
              data-testid="toggle-theme"
              title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
            </button>
            <ModelPicker />
          </header>

          {activeSessionId === null ? <FirstRun /> : <Transcript />}
          <Composer />
        </main>

        <CanvasPane />
        <ContextInspector />
        <WorkspacePanel />
        <SideThread />
      </div>

      <SettingsDialog />
      <SecretWarning />
      <CommandPalette />
    </div>
  )
}
