import { create } from 'zustand'
import type { ChatMessage, Mode, ProviderError, ProviderSummary, StreamEvent } from '@shared/types'
import { scanSecrets, type SecretCategory } from '@shared/secret-scan'

function newId(): string {
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

interface SessionMeta {
  id: string
  title: string
  updatedAt: number
  pinned?: boolean
  archived?: boolean
  tags?: string[]
}
export interface Fallback { providerId: string; model: string }

// Shared with Splitter.tsx, which needs the same bounds to report accurate
// aria-valuemin/aria-valuemax for its keyboard-resize affordance — a single
// source of truth keeps the two from silently drifting apart.
export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 480

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
  /**
   * Which session owns the in-flight (or most recently finished) stream.
   * `streamingText` accumulates for THIS session regardless of which session
   * the user is currently viewing (`activeSessionId`) — viewing and
   * streaming are independent. A view should only render `streamingText`
   * when `streamingSessionId === activeSessionId`.
   *
   * KNOWN LIMITATION (v0, accepted): this is a single buffer, not a
   * per-session map. If the user starts a new turn in session B while
   * session A's turn is still streaming, `send()` overwrites
   * `streamingSessionId` to B and A's remaining events then fail the gate.
   * A's reply disappears from any live view but is still persisted by main
   * and reappears when the user reloads session A. A `Record<sessionId,
   * StreamState>` would fix this but is deliberately out of scope for v0.
   */
  streamingSessionId: string | null
  streamingText: string
  error: ProviderError | null
  /** Transient engine status (e.g. a failover notice) shown above the reply. */
  streamNotice: string | null
  providerId: string
  providers: ProviderSummary[]
  model: string
  /** Ordered failover targets, persisted in settings, sent with each turn. */
  fallbacks: Fallback[]
  /** Named presets (system prompt + model + temperature), persisted in settings. */
  modes: Mode[]
  activeModeId: string | null
  sidebarWidth: number
  settingsOpen: boolean
  /** Sidebar filter. Purely client-side over the already-loaded session index. */
  query: string
  theme: 'dark' | 'light'
  /** OS platform, from appInfo(). Drives the frameless title-bar chrome. */
  platform: string
  /** Whether the context inspector drawer is open. */
  inspectorOpen: boolean
  /** Side-thread drawer open state + optional seeded quote. Streaming for the
   *  side thread is handled entirely inside SideThread (its own session + event
   *  subscription), so none of the main streaming fields are touched. */
  sideThreadOpen: boolean
  sideThreadSeed: string
  /** The element markup selected in the canvas for point-and-refine (Canvas 8). */
  canvasSelection: string | null
  /** Composer draft, held here so attachments and the secret guard can act on it. */
  draft: string
  /** Set when send is paused because the draft looks like it contains secrets. */
  pendingSecret: SecretCategory[] | null

  openSettings(): void
  closeSettings(): void
  toggleInspector(): void
  openSideThread(seed: string): void
  closeSideThread(): void
  setDraft(value: string): void
  setCanvasSelection(outerHTML: string | null): void
  /** Scans the draft; sends if clean, otherwise opens the secret-warning gate. */
  requestSend(): void
  confirmSecretSend(): void
  cancelSecretSend(): void
  setQuery(value: string): void
  setTheme(theme: 'dark' | 'light'): void
  loadPlatform(): Promise<void>
  renameSession(id: string, title: string): Promise<void>
  deleteSession(id: string): Promise<void>
  /**
   * Surfaces a caught bridge failure through the shared `error` field, the
   * same path every in-store IPC caller already uses (see `catch (err) {
   * set({ error: toProviderError(err) }) }` throughout this file). Exported
   * so callers outside a store action — SettingsDialog.tsx makes bridge
   * calls directly rather than through a store method — can report a
   * failure the same way instead of swallowing it.
   */
  reportError(err: unknown): void
  loadSessions(): Promise<void>
  loadProviders(): Promise<void>
  loadSettings(): Promise<void>
  setFallbacks(fallbacks: Fallback[]): Promise<void>
  saveMode(mode: Mode): Promise<void>
  deleteMode(id: string): Promise<void>
  setActiveMode(id: string | null): void
  togglePin(id: string): Promise<void>
  toggleArchive(id: string): Promise<void>
  setSessionTags(id: string, tags: string[]): Promise<void>
  refreshMessages(): Promise<void>
  branchFrom(messageId: string): Promise<void>
  editUserMessage(messageId: string, content: string): Promise<void>
  editAssistantMessage(messageId: string, content: string): Promise<void>
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
  streamingSessionId: null,
  streamingText: '',
  error: null,
  streamNotice: null,
  providerId: '',
  providers: [],
  model: '',
  fallbacks: [],
  modes: [],
  activeModeId: null,
  sidebarWidth: 300,
  settingsOpen: false,
  query: '',
  theme: 'dark',
  platform: '',
  inspectorOpen: false,
  sideThreadOpen: false,
  sideThreadSeed: '',
  canvasSelection: null,
  draft: '',
  pendingSecret: null,

  openSettings() { set({ settingsOpen: true }) },
  closeSettings() { set({ settingsOpen: false }) },
  toggleInspector() { set((s) => ({ inspectorOpen: !s.inspectorOpen })) },
  openSideThread(seed) { set({ sideThreadOpen: true, sideThreadSeed: seed }) },
  closeSideThread() { set({ sideThreadOpen: false, sideThreadSeed: '' }) },
  setDraft(value) { set({ draft: value }) },
  setCanvasSelection(outerHTML) { set({ canvasSelection: outerHTML }) },

  // Outbound secret guard (roadmap 28): scan before anything leaves the
  // machine. A match pauses the send and opens a confirm gate rather than
  // blocking outright — a guard against the common paste-a-key accident, not a
  // hard stop, since the user may legitimately be discussing a key.
  requestSend() {
    const content = get().draft.trim()
    if (!content || (get().streamId !== null && get().streamingSessionId === get().activeSessionId)) return
    const categories = [...new Set(scanSecrets(content).map((m) => m.category))]
    if (categories.length > 0) { set({ pendingSecret: categories }); return }
    set({ draft: '' })
    void get().send(content)
  },

  confirmSecretSend() {
    const content = get().draft.trim()
    set({ pendingSecret: null, draft: '' })
    if (content) void get().send(content)
  },

  cancelSecretSend() { set({ pendingSecret: null }) },
  reportError(err) { set({ error: toProviderError(err) }) },
  setQuery(value) { set({ query: value }) },
  setTheme(theme) { set({ theme }) },

  async loadPlatform() {
    try {
      const info = await window.openCoder.appInfo()
      set({ platform: info.platform })
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  async loadSettings() {
    try {
      const settings = await window.openCoder.settings.get()
      const fallbacks = settings['fallbacks']
      if (Array.isArray(fallbacks)) set({ fallbacks: fallbacks as Fallback[] })
      const modes = settings['modes']
      if (Array.isArray(modes)) set({ modes: modes as Mode[] })
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  async setFallbacks(fallbacks) {
    set({ fallbacks })
    try {
      await window.openCoder.settings.set({ fallbacks })
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  async saveMode(mode) {
    const modes = get().modes.some((m) => m.id === mode.id)
      ? get().modes.map((m) => (m.id === mode.id ? mode : m))
      : [...get().modes, mode]
    set({ modes })
    try {
      await window.openCoder.settings.set({ modes })
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  async deleteMode(id) {
    const modes = get().modes.filter((m) => m.id !== id)
    set({ modes, activeModeId: get().activeModeId === id ? null : get().activeModeId })
    try {
      await window.openCoder.settings.set({ modes })
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  // Applying a mode optionally switches the model, then its system prompt and
  // temperature ride along on subsequent sends (see send()).
  setActiveMode(id) {
    set({ activeModeId: id })
    if (id === null) return
    const mode = get().modes.find((m) => m.id === id)
    if (mode?.providerId) set({ providerId: mode.providerId })
    if (mode?.model) set({ model: mode.model })
  },

  async togglePin(id) {
    const current = get().sessions.find((s) => s.id === id)?.pinned ?? false
    try {
      await window.openCoder.sessions.setPinned(id, !current)
      await get().loadSessions()
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  async toggleArchive(id) {
    const current = get().sessions.find((s) => s.id === id)?.archived ?? false
    try {
      await window.openCoder.sessions.setArchived(id, !current)
      await get().loadSessions()
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  async setSessionTags(id, tags) {
    try {
      await window.openCoder.sessions.setTags(id, tags)
      await get().loadSessions()
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  // Reloads the active session's messages from disk, replacing the optimistic
  // `local-*` ids used during streaming with the canonical persisted ids that
  // edit and fork operate on. Fire-and-forget after a turn completes.
  async refreshMessages() {
    const id = get().activeSessionId
    if (!id) return
    try {
      set({ messages: await window.openCoder.sessions.load(id) })
    } catch {
      // A refresh failure is non-fatal — the optimistic messages remain shown.
    }
  },

  async branchFrom(messageId) {
    const sourceId = get().activeSessionId
    if (!sourceId) return
    try {
      const { id } = await window.openCoder.sessions.branch(sourceId, messageId, 'Fork')
      await get().loadSessions()
      await get().selectSession(id)
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  // Editing a user message rewinds the conversation to just before it, then
  // sends the edited text as a fresh turn.
  async editUserMessage(messageId, content) {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    try {
      await window.openCoder.sessions.truncateFrom(sessionId, messageId)
      set({ messages: await window.openCoder.sessions.load(sessionId) })
      await get().send(content)
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  // Editing an assistant message rewrites its content in place (put words in its
  // mouth), without re-running the turn.
  async editAssistantMessage(messageId, content) {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    try {
      await window.openCoder.sessions.editMessage(sessionId, messageId, content)
      set({ messages: await window.openCoder.sessions.load(sessionId) })
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  async renameSession(id, title) {
    const trimmed = title.trim()
    if (!trimmed) return
    try {
      await window.openCoder.sessions.rename(id, trimmed)
      await get().loadSessions()
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  // Removing the session currently on screen must also clear what it was
  // showing, otherwise the transcript keeps rendering messages belonging to a
  // conversation that no longer exists.
  async deleteSession(id) {
    try {
      await window.openCoder.sessions.delete(id)
      if (get().activeSessionId === id) {
        set({ activeSessionId: null, messages: [], error: null })
      }
      await get().loadSessions()
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  async loadSessions() {
    try {
      set({ sessions: await window.openCoder.sessions.list() })
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  // Selects the first provider (and its first model) only when nothing is
  // chosen yet, or the current selection no longer exists. This is what lets
  // the E2E fake provider (registered first under OPEN_CODER_FAKE_PROVIDER)
  // become the active selection with no test-only code in the renderer.
  async loadProviders() {
    try {
      const list = await window.openCoder.providers.list()
      set({ providers: list })
      const current = get().providerId
      if (!current || !list.some((p) => p.id === current)) {
        const first = list[0]
        if (!first) return
        set({ providerId: first.id })
        const models = await window.openCoder.providers.models(first.id).catch(() => [])
        if (models[0]) set({ model: models[0].id })
      }
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  // Switching sessions clears `error` (a stale error belongs to whichever
  // session raised it, not to the one being loaded now) but must NOT touch
  // `streamingText`/`streamingSessionId`/`streamId`/`lastStreamId` — those
  // belong to whichever session owns the in-flight stream, independent of
  // which session is being viewed. Clearing `streamingText` here previously
  // caused a regression: switching away from a streaming session and back
  // wiped the accumulated buffer, truncating the eventual assistant message
  // to only the text that arrived after the return. The in-flight turn (if
  // any) keeps running in main and persists normally regardless of what the
  // user is looking at.
  async selectSession(id) {
    try {
      const messages = await window.openCoder.sessions.load(id)
      set({ activeSessionId: id, messages, error: null })
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
    // Sending with no model selected (e.g. right after switching provider in
    // Settings, before a model list is available) would otherwise reach
    // main's zod schema, which rejects the empty string as a raw validation
    // error mapped to an unhelpful 'unknown'/Retry. This is a distinct
    // condition from 'auth' (the provider rejected the credentials) — an
    // empty model can happen for reasons that have nothing to do with a
    // missing key (a keyless local runtime whose server isn't running yet,
    // or a transient failure fetching the model list), so it gets its own
    // 'no_model' kind rather than borrowing 'auth'. Both kinds happen to
    // share the "Open settings" recovery action (see ErrorNotice.tsx /
    // Transcript.tsx), which is fine — two kinds can share an affordance
    // without one lying about the cause.
    if (!get().model) {
      set({ error: { kind: 'no_model', message: 'No model is selected. Choose one in settings.' } })
      return
    }
    // A new turn genuinely starts a new buffer, so resetting streamingText
    // and (re)pointing streamingSessionId at the target session here is
    // correct even though selectSession must never do the equivalent.
    set((s) => ({
      error: null,
      streamNotice: null,
      streamingText: '',
      streamingSessionId: sessionId,
      messages: [...s.messages, {
        id: `local-${Date.now()}`, role: 'user', content, createdAt: Date.now(),
      }],
    }))
    try {
      // Only fall back to targets other than the current selection, so a
      // fallback list that happens to include the primary does not retry it.
      const fallbacks = get().fallbacks.filter(
        (f) => !(f.providerId === get().providerId && f.model === get().model),
      )
      const mode = get().modes.find((m) => m.id === get().activeModeId)
      const { streamId } = await window.openCoder.chat.send({
        sessionId,
        providerId: get().providerId,
        model: get().model,
        content,
        ...(fallbacks.length > 0 ? { fallbacks } : {}),
        ...(mode?.systemPrompt ? { systemPrompt: mode.systemPrompt } : {}),
        ...(mode?.temperature !== undefined ? { temperature: mode.temperature } : {}),
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
      set((s) => {
        // The Composer only ever renders the Stop button (and therefore only
        // ever calls stop()) when `streamingSessionId === activeSessionId`
        // (see Composer.tsx), so this is always the session on screen — but
        // re-check with fresh state rather than a value captured before the
        // `await`, since the user could (in principle) have navigated during
        // the abort round-trip.
        //
        // Appending locally (rather than waiting for a reload) is what makes
        // the "Stopped before completion." label appear immediately instead
        // of only after the user leaves and returns to this session. This
        // cannot double-append: selectSession() always *replaces* `messages`
        // wholesale from disk (`set({ messages, ... })`), it never appends to
        // the in-memory array, so when the user later reloads this session
        // the locally-appended message here is simply overwritten by the one
        // persisted copy stream-engine.ts wrote to disk (see the `incomplete`
        // fix there) — never added alongside it.
        const shouldAppend = s.streamingText !== '' && s.streamingSessionId === s.activeSessionId
        return {
          streamId: null,
          streamingText: '',
          messages: shouldAppend
            ? [...s.messages, {
              id: `local-stopped-${Date.now()}`, role: 'assistant',
              content: s.streamingText, createdAt: Date.now(), incomplete: true,
            }]
            : s.messages,
        }
      })
    }
  },

  setProvider(id) { set({ providerId: id, model: '' }) },
  setModel(id) { set({ model: id }) },
  setSidebarWidth(px) {
    set({ sidebarWidth: Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, px)) })
  },

  // Gate on BOTH identifiers: an envelope only applies to the turn it belongs
  // to (`lastStreamId` — see field doc above) AND the session that OWNS the
  // stream (`streamingSessionId` — NOT `activeSessionId`). Accumulation must
  // continue for the owning session no matter what the user is currently
  // looking at: gating on `activeSessionId` here was the Fix Round 2
  // regression — it wiped and re-accumulated the buffer every time the user
  // navigated away and back, truncating the eventual message to only the
  // text that arrived after the return.
  //
  // Routing on `lastStreamId` (not `streamId`) means a second terminal event
  // for the same turn is still accepted: `streamId` is cleared by the first
  // `error`/`done` (it only tracks "are we currently streaming"), but
  // `lastStreamId` keeps identifying the turn, so e.g. a persistence error
  // arriving after the provider error already terminated the stream still
  // matches and replaces the displayed error with the more actionable one.
  applyEvent({ streamId, sessionId, event }) {
    if (streamId !== get().lastStreamId) return
    if (sessionId !== get().streamingSessionId) return
    if (event.type === 'notice') {
      // Engine status (a failover retry). Shown transiently for the owning
      // session only; not persisted, cleared when the next turn starts.
      if (sessionId === get().activeSessionId) set({ streamNotice: event.text })
      return
    }
    if (event.type === 'reasoning') {
      // Reasoning/thinking deltas are not rendered in v0; ignore rather than
      // letting them fall through to the text accumulator.
      return
    }
    if (event.type === 'text') {
      // If `streamId` is already null, the renderer has already considered
      // this turn over — most commonly because the user just clicked Stop,
      // and this chunk was in flight the instant the abort signal fired,
      // arriving a moment after stop() already cleared and locally persisted
      // `streamingText` as an incomplete message. Accumulating it here would
      // silently resurrect a streaming bubble with no label, and duplicate
      // text once the session is reloaded from disk (stream-engine.ts only
      // persisted what it had already sent before the abort was observed).
      if (get().streamId === null) return
      set((s) => ({ streamingText: s.streamingText + event.delta }))
      return
    }
    if (event.type === 'error') {
      // Only surface the error if the user is looking at the session it
      // belongs to — an error for a session the user has navigated away
      // from should not hijack whatever is currently displayed. `streamId`
      // is always cleared so the composer leaves its streaming state
      // regardless of which session is active. `streamingText` is cleared
      // unconditionally: whatever partial text had accumulated is either
      // about to be reloaded from disk (stream-engine.ts persists it marked
      // `incomplete`) or was never worth showing, and leaving it in the
      // buffer would otherwise render a raw, unlabeled streaming bubble
      // alongside the error notice.
      set((s) => ({
        error: sessionId === s.activeSessionId ? event.error : s.error,
        streamId: null,
        streamingText: '',
        streamNotice: null,
      }))
      return
    }
    if (event.type === 'done') {
      set((s) => {
        // Only append the assistant message when the user is currently
        // looking at the session the stream belongs to. If they've
        // navigated elsewhere, main has already persisted the reply, so
        // returning to that session later reloads it from disk instead —
        // this is what prevents the reply from leaking into whatever
        // session the user is currently viewing.
        const shouldAppend = sessionId === s.activeSessionId
        // Carry the provenance from the done event so the model badge and cost
        // appear immediately, accurate even when failover changed the model —
        // rather than only after the session is reloaded from disk.
        const provenance = event.type === 'done'
          ? {
              ...(event.model ? { model: event.model } : {}),
              ...(event.provider ? { provider: event.provider } : {}),
              ...(event.usage ? { usage: event.usage } : {}),
            }
          : {}
        return {
          streamId: null,
          streamingText: '',
          streamNotice: null,
          messages: shouldAppend
            ? [...s.messages, {
              id: `local-a-${Date.now()}`, role: 'assistant',
              content: s.streamingText, createdAt: Date.now(), ...provenance,
            }]
            : s.messages,
        }
      })
      // Canonicalize ids so edit/fork on the just-finished turn use real
      // persisted ids, not the optimistic local-* ones.
      if (sessionId === get().activeSessionId) void get().refreshMessages()
    }
  },
}))
