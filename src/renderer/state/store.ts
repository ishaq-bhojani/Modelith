import { create } from 'zustand'
import type { ChatMessage, ProviderError, StreamEvent } from '@shared/types'

interface SessionMeta { id: string; title: string; updatedAt: number }
interface ProviderMeta { id: string; label: string }

function toProviderError(err: unknown): ProviderError {
  return { kind: 'unknown', message: err instanceof Error ? err.message : String(err) }
}

interface AppState {
  sessions: SessionMeta[]
  activeSessionId: string | null
  messages: ChatMessage[]
  /** Non-null exactly while a stream is in flight; cleared by `error`/`done`. */
  streamId: string | null
  /**
   * The streamId of the most recently started turn. Unlike `streamId`, this is
   * NOT cleared when the turn ends — it is what `applyEvent` routes on, so a
   * second terminal event for the same turn (e.g. a persistence error arriving
   * after the provider error already cleared `streamId`) is still recognized
   * as belonging to the current turn instead of being silently discarded.
   */
  lastStreamId: string | null
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
  lastStreamId: null,
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
    try {
      set({ sessions: await window.openCoder.sessions.list() })
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  // Switching sessions clears streamingText/error so a half-rendered reply
  // (or a stale error) from the session being left cannot bleed into the
  // newly loaded conversation. The in-flight turn (if any) keeps running in
  // main and persists normally; returning to that session later reloads the
  // completed reply from disk via this same method.
  async selectSession(id) {
    try {
      const messages = await window.openCoder.sessions.load(id)
      set({ activeSessionId: id, messages, error: null, streamingText: '' })
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  async newSession() {
    try {
      const { id } = await window.openCoder.sessions.create('New chat')
      await get().loadSessions()
      await get().selectSession(id)
    } catch (err) {
      set({ error: toProviderError(err) })
    }
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
    try {
      const { streamId } = await window.openCoder.chat.send({
        sessionId,
        providerId: get().providerId,
        model: get().model,
        ...(get().baseUrl ? { baseUrl: get().baseUrl } : {}),
        content,
      })
      set({ streamId, lastStreamId: streamId })
    } catch (err) {
      set({ error: toProviderError(err), streamId: null })
    }
  },

  async stop() {
    const id = get().streamId
    try {
      if (id) await window.openCoder.chat.abort(id)
    } catch (err) {
      set({ error: toProviderError(err) })
    } finally {
      set({ streamId: null })
    }
  },

  setProvider(id) { set({ providerId: id, model: '' }) },
  setModel(id) { set({ model: id }) },
  setSidebarWidth(px) { set({ sidebarWidth: Math.min(480, Math.max(180, px)) }) },

  // Gate on BOTH identifiers: an envelope only applies to the turn it belongs
  // to (`lastStreamId` — see field doc above) AND the session currently
  // displayed (`activeSessionId`). Without the session check, switching to a
  // different session mid-stream would let the old turn's `text`/`done`
  // events keep appending into the newly loaded conversation's messages —
  // reachable simply by clicking another session in the sidebar while a
  // reply is streaming.
  //
  // Routing on `lastStreamId` (not `streamId`) means a second terminal event
  // for the same turn is still accepted: `streamId` is cleared by the first
  // `error`/`done` (it only tracks "are we currently streaming"), but
  // `lastStreamId` keeps identifying the turn, so e.g. a persistence error
  // arriving after the provider error already terminated the stream still
  // matches and replaces the displayed error with the more actionable one.
  applyEvent({ streamId, sessionId, event }) {
    if (streamId !== get().lastStreamId) return
    if (sessionId !== get().activeSessionId) return
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
