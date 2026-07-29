import { create } from 'zustand'
import type { ChatMessage, ProviderError, StreamEvent } from '@shared/types'

interface SessionMeta { id: string; title: string; updatedAt: number }
interface ProviderMeta { id: string; label: string }

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
  providerId: string
  providers: ProviderMeta[]
  model: string
  sidebarWidth: number
  settingsOpen: boolean

  openSettings(): void
  closeSettings(): void
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
  providerId: '',
  providers: [],
  model: '',
  sidebarWidth: 260,
  settingsOpen: false,

  openSettings() { set({ settingsOpen: true }) },
  closeSettings() { set({ settingsOpen: false }) },
  reportError(err) { set({ error: toProviderError(err) }) },

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
      streamingText: '',
      streamingSessionId: sessionId,
      messages: [...s.messages, {
        id: `local-${Date.now()}`, role: 'user', content, createdAt: Date.now(),
      }],
    }))
    try {
      const { streamId } = await window.openCoder.chat.send({
        sessionId,
        providerId: get().providerId,
        model: get().model,
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
        return {
          streamId: null,
          streamingText: '',
          messages: shouldAppend
            ? [...s.messages, {
              id: `local-a-${Date.now()}`, role: 'assistant',
              content: s.streamingText, createdAt: Date.now(),
            }]
            : s.messages,
        }
      })
    }
  },
}))
