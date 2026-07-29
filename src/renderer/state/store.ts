import { create } from 'zustand'
import type { ChatMessage, ProviderError, StreamEvent } from '@shared/types'

interface SessionMeta { id: string; title: string; updatedAt: number }
interface ProviderMeta { id: string; label: string }

interface AppState {
  sessions: SessionMeta[]
  activeSessionId: string | null
  messages: ChatMessage[]
  streamId: string | null
  streamingText: string
  error: ProviderError | null
  providerId: string
  providers: ProviderMeta[]
  model: string
  baseUrl: string | undefined
  sidebarWidth: number
  settingsOpen: boolean

  openSettings(): void
  closeSettings(): void
  loadSessions(): Promise<void>
  selectSession(id: string): Promise<void>
  newSession(): Promise<void>
  send(content: string): Promise<void>
  stop(): Promise<void>
  setProvider(id: string): void
  setModel(id: string): void
  setSidebarWidth(px: number): void
  applyEvent(envelope: { streamId: string; sessionId: string; event: StreamEvent }): void
}

export const useAppStore = create<AppState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  streamId: null,
  streamingText: '',
  error: null,
  providerId: '',
  providers: [],
  model: '',
  baseUrl: undefined,
  sidebarWidth: 260,
  settingsOpen: false,

  openSettings() { set({ settingsOpen: true }) },
  closeSettings() { set({ settingsOpen: false }) },

  async loadSessions() {
    set({ sessions: await window.openCoder.sessions.list() })
  },

  async selectSession(id) {
    set({ activeSessionId: id, messages: await window.openCoder.sessions.load(id), error: null })
  },

  async newSession() {
    const { id } = await window.openCoder.sessions.create('New chat')
    await get().loadSessions()
    await get().selectSession(id)
  },

  async send(content) {
    let sessionId = get().activeSessionId
    if (!sessionId) { await get().newSession(); sessionId = get().activeSessionId }
    if (!sessionId) return
    set((s) => ({
      error: null,
      streamingText: '',
      messages: [...s.messages, {
        id: `local-${Date.now()}`, role: 'user', content, createdAt: Date.now(),
      }],
    }))
    const { streamId } = await window.openCoder.chat.send({
      sessionId,
      providerId: get().providerId,
      model: get().model,
      ...(get().baseUrl ? { baseUrl: get().baseUrl } : {}),
      content,
    })
    set({ streamId })
  },

  async stop() {
    const id = get().streamId
    if (id) await window.openCoder.chat.abort(id)
    set({ streamId: null })
  },

  setProvider(id) { set({ providerId: id, model: '' }) },
  setModel(id) { set({ model: id }) },
  setSidebarWidth(px) { set({ sidebarWidth: Math.min(480, Math.max(180, px)) }) },

  // Chunks from a superseded or aborted stream are discarded by streamId. Once
  // an error (or done) event clears streamId to null, every later envelope for
  // that same now-stale stream fails the `streamId !== get().streamId` check
  // and is dropped — so a second error for one turn (e.g. provider failure
  // followed by a persistence failure) can never throw or clobber state after
  // the first has already terminated the stream.
  applyEvent({ streamId, event }) {
    if (streamId !== get().streamId) return
    if (event.type === 'text') { set((s) => ({ streamingText: s.streamingText + event.delta })); return }
    if (event.type === 'error') { set({ error: event.error, streamId: null }); return }
    if (event.type === 'done') {
      set((s) => ({
        streamId: null,
        streamingText: '',
        messages: [...s.messages, {
          id: `local-a-${Date.now()}`, role: 'assistant',
          content: s.streamingText, createdAt: Date.now(),
        }],
      }))
    }
  },
}))
