import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '../shared/ipc.js'
import type { AppInfo } from '../shared/ipc.js'
import type { Attachment, ChatMessage, ContextPreview, GitStatus, McpServerStatus, ModelInfo, ProjectMeta, ProviderSummary, StreamEnvelope, UpdateState, WorkspaceTreeEntry } from '../shared/types.js'

export type { StreamEnvelope } from '../shared/types.js'

export interface ModelithBridge {
  appInfo(): Promise<AppInfo>
  keys: {
    set(providerId: string, apiKey: string): Promise<void>
    delete(providerId: string): Promise<void>
    has(providerId: string): Promise<boolean>
  }
  providers: {
    list(): Promise<ProviderSummary[]>
    models(providerId: string): Promise<ModelInfo[]>
  }
  chat: {
    send(input: {
      sessionId: string; providerId: string; model: string; content: string
      attachments?: Attachment[]
      agent?: boolean
      systemPrompt?: string; temperature?: number
      fallbacks?: { providerId: string; model: string }[]
    }): Promise<{ streamId: string }>
    abort(streamId: string): Promise<void>
    onEvent(handler: (envelope: StreamEnvelope) => void): () => void
    preview(sessionId: string): Promise<ContextPreview>
    /** Deliver a diff-gate decision (agentic-edits spec §4). */
    toolDecision(callId: string, action: 'accept' | 'reject' | 'edited', content?: string, trustTurn?: boolean): Promise<void>
    /** Start a Model Race across 2–4 targets (model-race spec §2). */
    startRace(input: { sessionId: string; content: string; systemPrompt?: string; temperature?: number; entries: { providerId: string; model: string }[] }): Promise<{ raceId: string }>
    /** Persist the chosen race column as the turn's reply. */
    chooseWinner(raceId: string, columnId: string): Promise<void>
  }
  sessions: {
    list(): Promise<{ id: string; title: string; updatedAt: number; pinned?: boolean; archived?: boolean; tags?: string[] }[]>
    load(id: string): Promise<ChatMessage[]>
    create(title: string): Promise<{ id: string }>
    delete(id: string): Promise<void>
    rename(id: string, title: string): Promise<void>
    setPinned(id: string, pinned: boolean): Promise<void>
    setArchived(id: string, archived: boolean): Promise<void>
    setTags(id: string, tags: string[]): Promise<void>
    branch(sourceId: string, uptoId: string, title: string): Promise<{ id: string }>
    truncateFrom(id: string, messageId: string): Promise<void>
    editMessage(id: string, messageId: string, content: string): Promise<void>
    /** File (or unfile, with null) a session under a project (projects spec). */
    setProject(id: string, projectId: string | null): Promise<void>
  }
  window: {
    minimize(): Promise<void>
    maximizeToggle(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    onMaximizedChange(handler: (isMaximized: boolean) => void): () => void
    openChatsFolder(): Promise<void>
    about(): Promise<void>
    quit(): Promise<void>
  }
  /** Subscribe to a keyboard-accelerator action forwarded from the app menu. */
  onMenu(action: 'new-chat' | 'settings' | 'command-palette' | 'search', handler: () => void): () => void
  settings: {
    get(): Promise<Record<string, unknown>>
    set(patch: Record<string, unknown>): Promise<void>
  }
  /** Read-only workspace folder access (spec §A). The root is chosen and held
   *  by main; the renderer only ever passes a root-relative path. */
  workspace: {
    pick(): Promise<string | null>
    current(): Promise<string | null>
    tree(): Promise<WorkspaceTreeEntry[]>
    read(relPath: string): Promise<{ relPath: string; text: string }>
    /** Revert every edit made in a turn (agentic-edits spec §5). */
    revert(turnId: string): Promise<number>
  }
  /** Projects (projects spec). No method accepts a path — the folder comes
   *  from the native dialog in main. */
  projects: {
    list(): Promise<{ projects: ProjectMeta[]; activeId: string | null }>
    create(): Promise<{ projects: ProjectMeta[]; activeId: string | null }>
    rename(id: string, name: string): Promise<{ projects: ProjectMeta[]; activeId: string | null }>
    remove(id: string): Promise<{ projects: ProjectMeta[]; activeId: string | null }>
    setActive(id: string | null): Promise<{ projects: ProjectMeta[]; activeId: string | null }>
  }
  /** MCP server management (mcp-client spec §2). */
  mcp: {
    list(): Promise<McpServerStatus[]>
    add(config: { id: string; name: string; command: string; args?: string[]; env?: Record<string, string>; enabled?: boolean }): Promise<McpServerStatus[]>
    remove(id: string): Promise<McpServerStatus[]>
    setEnabled(id: string, enabled: boolean): Promise<McpServerStatus[]>
  }
  /** View-only git state for the Git panel (terminal-git spec §2). */
  git: {
    status(): Promise<GitStatus>
    diff(path?: string): Promise<string>
  }
  /** Software updates (auto-update spec). Read-only from the renderer's side:
   *  there is deliberately no way to supply a feed URL, owner, or repo. */
  updates: {
    getState(): Promise<UpdateState>
    check(): Promise<void>
    install(): Promise<void>
    setEnabled(enabled: boolean): Promise<void>
    onStateChange(handler: (state: UpdateState) => void): () => void
  }
}

const bridge: ModelithBridge = {
  appInfo: () => ipcRenderer.invoke(CHANNELS.appInfo),
  keys: {
    set: (providerId, apiKey) => ipcRenderer.invoke(CHANNELS.keySet, { providerId, apiKey }),
    delete: (providerId) => ipcRenderer.invoke(CHANNELS.keyDelete, { providerId }),
    has: (providerId) => ipcRenderer.invoke(CHANNELS.keyHas, { providerId }),
  },
  providers: {
    list: () => ipcRenderer.invoke(CHANNELS.providersList),
    models: (providerId) => ipcRenderer.invoke(CHANNELS.modelsList, { providerId }),
  },
  chat: {
    send: (input) => ipcRenderer.invoke(CHANNELS.chatSend, input),
    abort: (streamId) => ipcRenderer.invoke(CHANNELS.chatAbort, { streamId }),
    onEvent: (handler) => {
      const listener = (_e: unknown, envelope: StreamEnvelope) => handler(envelope)
      ipcRenderer.on(CHANNELS.chatEvent, listener)
      return () => { ipcRenderer.off(CHANNELS.chatEvent, listener) }
    },
    preview: (sessionId) => ipcRenderer.invoke(CHANNELS.chatPreview, { id: sessionId }),
    toolDecision: (callId, action, content, trustTurn) => ipcRenderer.invoke(CHANNELS.chatToolDecision, { callId, action, content, trustTurn }),
    startRace: (input) => ipcRenderer.invoke(CHANNELS.chatRace, input),
    chooseWinner: (raceId, columnId) => ipcRenderer.invoke(CHANNELS.chatChooseWinner, { raceId, columnId }),
  },
  sessions: {
    list: () => ipcRenderer.invoke(CHANNELS.sessionsList),
    load: (id) => ipcRenderer.invoke(CHANNELS.sessionLoad, { id }),
    create: (title) => ipcRenderer.invoke(CHANNELS.sessionCreate, { title }),
    delete: (id) => ipcRenderer.invoke(CHANNELS.sessionDelete, { id }),
    rename: (id, title) => ipcRenderer.invoke(CHANNELS.sessionRename, { id, title }),
    setPinned: (id, pinned) => ipcRenderer.invoke(CHANNELS.sessionSetPinned, { id, pinned }),
    setArchived: (id, archived) => ipcRenderer.invoke(CHANNELS.sessionSetArchived, { id, archived }),
    setTags: (id, tags) => ipcRenderer.invoke(CHANNELS.sessionSetTags, { id, tags }),
    branch: (sourceId, uptoId, title) => ipcRenderer.invoke(CHANNELS.sessionBranch, { sourceId, uptoId, title }),
    truncateFrom: (id, messageId) => ipcRenderer.invoke(CHANNELS.sessionTruncateFrom, { id, messageId }),
    editMessage: (id, messageId, content) => ipcRenderer.invoke(CHANNELS.sessionEditMessage, { id, messageId, content }),
    setProject: (id, projectId) => ipcRenderer.invoke(CHANNELS.sessionSetProject, { id, projectId }),
  },
  window: {
    minimize: () => ipcRenderer.invoke(CHANNELS.windowMinimize),
    maximizeToggle: () => ipcRenderer.invoke(CHANNELS.windowMaximizeToggle),
    close: () => ipcRenderer.invoke(CHANNELS.windowClose),
    isMaximized: () => ipcRenderer.invoke(CHANNELS.windowIsMaximized),
    onMaximizedChange: (handler) => {
      const listener = (_e: unknown, isMaximized: boolean) => handler(isMaximized)
      ipcRenderer.on(CHANNELS.windowMaximizedChanged, listener)
      return () => { ipcRenderer.off(CHANNELS.windowMaximizedChanged, listener) }
    },
    openChatsFolder: () => ipcRenderer.invoke(CHANNELS.windowOpenChatsFolder),
    about: () => ipcRenderer.invoke(CHANNELS.windowAbout),
    quit: () => ipcRenderer.invoke(CHANNELS.appQuit),
  },
  onMenu: (action, handler) => {
    const channel = {
      'new-chat': CHANNELS.menuNewChat,
      settings: CHANNELS.menuSettings,
      'command-palette': CHANNELS.menuCommandPalette,
      search: CHANNELS.menuSearch,
    }[action]
    const listener = () => handler()
    ipcRenderer.on(channel, listener)
    return () => { ipcRenderer.off(channel, listener) }
  },
  settings: {
    get: () => ipcRenderer.invoke(CHANNELS.settingsGet),
    set: (patch) => ipcRenderer.invoke(CHANNELS.settingsSet, patch),
  },
  workspace: {
    pick: () => ipcRenderer.invoke(CHANNELS.workspacePick),
    current: () => ipcRenderer.invoke(CHANNELS.workspaceCurrent),
    tree: () => ipcRenderer.invoke(CHANNELS.workspaceTree),
    read: (relPath) => ipcRenderer.invoke(CHANNELS.workspaceRead, { relPath }),
    revert: (turnId) => ipcRenderer.invoke(CHANNELS.workspaceRevert, { turnId }),
  },
  projects: {
    list: () => ipcRenderer.invoke(CHANNELS.projectsList),
    create: () => ipcRenderer.invoke(CHANNELS.projectCreate),
    rename: (id, name) => ipcRenderer.invoke(CHANNELS.projectRename, { id, name }),
    remove: (id) => ipcRenderer.invoke(CHANNELS.projectRemove, { id }),
    setActive: (id) => ipcRenderer.invoke(CHANNELS.projectSetActive, { id }),
  },
  mcp: {
    list: () => ipcRenderer.invoke(CHANNELS.mcpList),
    add: (config) => ipcRenderer.invoke(CHANNELS.mcpAdd, config),
    remove: (id) => ipcRenderer.invoke(CHANNELS.mcpRemove, { id }),
    setEnabled: (id, enabled) => ipcRenderer.invoke(CHANNELS.mcpSetEnabled, { id, enabled }),
  },
  git: {
    status: () => ipcRenderer.invoke(CHANNELS.gitStatus),
    diff: (path) => ipcRenderer.invoke(CHANNELS.gitDiff, { path }),
  },
  updates: {
    getState: () => ipcRenderer.invoke(CHANNELS.updatesGet),
    check: () => ipcRenderer.invoke(CHANNELS.updatesCheck),
    install: () => ipcRenderer.invoke(CHANNELS.updatesInstall),
    setEnabled: (enabled) => ipcRenderer.invoke(CHANNELS.updatesSetEnabled, { enabled }),
    onStateChange: (handler) => {
      const listener = (_e: unknown, state: UpdateState) => handler(state)
      ipcRenderer.on(CHANNELS.updatesChanged, listener)
      return () => { ipcRenderer.off(CHANNELS.updatesChanged, listener) }
    },
  },
}

contextBridge.exposeInMainWorld('modelith', bridge)
