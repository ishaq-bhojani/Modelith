import { app, ipcMain, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { ZodError } from 'zod'
import {
  CHANNELS,
  KeyRefSchema,
  KeySetSchema,
  SendSchema,
  AbortSchema,
  SessionIdSchema,
  SessionCreateSchema,
  SessionRenameSchema,
  SessionSetPinnedSchema,
  SessionSetArchivedSchema,
  SessionSetTagsSchema,
  SessionBranchSchema,
  SessionMessageRefSchema,
  SessionEditMessageSchema,
  ModelsListSchema,
  SettingsPatchSchema,
  WorkspaceReadSchema,
  WorkspaceRevertSchema,
  ToolDecisionSchema,
  McpAddSchema,
  McpIdSchema,
  McpSetEnabledSchema,
  GitDiffSchema,
  RaceSchema,
  ChooseWinnerSchema,
  UpdatesSetEnabledSchema,
} from '../../shared/ipc.js'
import type { AppInfo } from '../../shared/ipc.js'
import type { ContextPreview, ContextPreviewEntry } from '../../shared/types.js'
import { Keystore } from '../secrets/keystore.js'
import { electronCrypto } from '../secrets/electron-crypto.js'
import { SessionStore } from '../sessions/store.js'
import { AppSettingsStore } from '../settings/store.js'
import { ProjectStore } from '../projects/store.js'
import { Workspace } from '../workspace/service.js'
import { CheckpointStore } from '../workspace/checkpoints.js'
import { McpManager } from '../mcp/manager.js'
import { GitService } from '../terminal/git.js'
import { StreamEngine } from '../chat/stream-engine.js'
import { applyContextBudget, estimateTokens } from '../chat/context-budget.js'
import { getProvider, listProviders, mainFetch } from '../providers/registry.js'
import { UpdaterService } from '../updater/service.js'
import { selectBackend } from '../updater/backend.js'
import { ElectronUpdaterBackend } from '../updater/electron-backend.js'
import { canAutoInstall, resolveInstallAction } from '../updater/policy.js'

const MAX_CONTEXT_TOKENS = 96_000

// Lazy singletons: `app.getPath('userData')` must not be evaluated until after
// index.ts has applied the MODELITH_USER_DATA portable-mode override. Since
// ES module imports are evaluated before any statement in the importing module,
// constructing these at module scope would read the path too early and break
// E2E isolation. Constructing on first use (from inside functions called
// within app.whenReady().then(...)) keeps ordering correct.
let keystoreInstance: Keystore | undefined
let sessionStoreInstance: SessionStore | undefined

export function getKeystore(): Keystore {
  keystoreInstance ??= new Keystore(electronCrypto, join(app.getPath('userData'), 'keys.json'))
  return keystoreInstance
}

export function getSessionStore(): SessionStore {
  sessionStoreInstance ??= new SessionStore(join(app.getPath('userData'), 'sessions'))
  return sessionStoreInstance
}

let settingsStoreInstance: AppSettingsStore | undefined
export function getSettingsStore(): AppSettingsStore {
  settingsStoreInstance ??= new AppSettingsStore(AppSettingsStore.defaultPath(app.getPath('userData')))
  return settingsStoreInstance
}

let projectStoreInstance: ProjectStore | undefined
export function getProjectStore(): ProjectStore {
  projectStoreInstance ??= new ProjectStore(ProjectStore.defaultPath(app.getPath('userData')))
  return projectStoreInstance
}

// A single Workspace (with its checkpoint store) shared by the workspace handlers
// and the chat engine, so reads, gated writes, and revert all confine to a root
// obtained the same way. getWindow is late-bound via a mutable holder.
let workspaceInstance: Workspace | undefined
let workspaceGetWindow: () => BrowserWindow | undefined = () => undefined
export function getWorkspace(): Workspace {
  workspaceInstance ??= new Workspace(
    getSettingsStore(),
    () => workspaceGetWindow(),
    new CheckpointStore(join(app.getPath('userData'), 'checkpoints')),
    getProjectStore(),
  )
  return workspaceInstance
}

let mcpInstance: McpManager | undefined
export function getMcpManager(): McpManager {
  mcpInstance ??= new McpManager(getSettingsStore())
  return mcpInstance
}

/**
 * Wraps an `ipcMain.handle` callback so a schema validation failure (a
 * malformed or tampered payload — `SchemaX.parse(raw)` throwing a
 * `ZodError`) surfaces to the renderer as a clean, readable message instead
 * of a raw ZodError dump. Electron propagates whatever an `ipcMain.handle`
 * callback throws to the renderer's `ipcRenderer.invoke()` rejection,
 * preserving only its `message` — the error taxonomy (`ProviderError`)
 * forbids a raw validation error ever reaching a chat bubble, so this is the
 * one seam where that message can be cleaned up before the renderer's
 * `toProviderError()` wraps it.
 */
export function withZodMapping<Args extends unknown[], R>(
  handler: (...args: Args) => R | Promise<R>,
): (...args: Args) => Promise<R> {
  return async (...args: Args) => {
    try {
      return await handler(...args)
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error('The request could not be processed: it was malformed.')
      }
      throw err
    }
  }
}

export function registerHandlers(): void {
  ipcMain.handle(CHANNELS.appInfo, (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
  }))
}

export function registerSecretHandlers(): void {
  ipcMain.handle(CHANNELS.keySet, withZodMapping(async (_e, raw: unknown) => {
    const { providerId, apiKey } = KeySetSchema.parse(raw)
    await getKeystore().set(providerId, apiKey)
  }))
  ipcMain.handle(CHANNELS.keyDelete, withZodMapping(async (_e, raw: unknown) => {
    await getKeystore().delete(KeyRefSchema.parse(raw).providerId)
  }))
  ipcMain.handle(CHANNELS.keyHas, withZodMapping(async (_e, raw: unknown) => {
    return getKeystore().has(KeyRefSchema.parse(raw).providerId)
  }))
}

export function registerWorkspaceHandlers(getWindow: () => BrowserWindow | undefined): void {
  workspaceGetWindow = getWindow
  const workspace = getWorkspace()
  // These are the UI's handlers, so they act on the ACTIVE project — the tree
  // and the file the user is looking at. An agent turn never comes through
  // here: it resolves its own root from its session (see StreamEngine).
  ipcMain.handle(CHANNELS.workspacePick, () => workspace.pick())
  ipcMain.handle(CHANNELS.workspaceCurrent, () => workspace.activeRoot())
  ipcMain.handle(CHANNELS.workspaceTree, async () => {
    const root = await workspace.activeRoot()
    if (!root) return []
    try {
      return await workspace.tree(root)
    } catch (err) {
      // A project's folder can vanish — deleted, renamed, or on an unmounted
      // drive. The spec keeps the project listed (it may come back) and shows
      // an empty tree rather than removing it or surfacing a raw ENOENT.
      if ((err as { code?: string }).code === 'ENOENT') return []
      throw err
    }
  })
  ipcMain.handle(CHANNELS.workspaceRead, withZodMapping(async (_e, raw: unknown) => {
    const root = await workspace.activeRoot()
    if (!root) throw new Error('No project is open.')
    return workspace.read(root, WorkspaceReadSchema.parse(raw).relPath)
  }))
  // Revert takes no root: each checkpoint restores into the root its write
  // landed in, so switching project before hitting Revert cannot redirect it.
  ipcMain.handle(CHANNELS.workspaceRevert, withZodMapping((_e, raw: unknown) => {
    return workspace.revertTurn(WorkspaceRevertSchema.parse(raw).turnId)
  }))
}

export function registerChatHandlers(getWindow: () => BrowserWindow | undefined): void {
  const store = getSessionStore()
  const engine = new StreamEngine({
    emit: (envelope) => {
      const window = getWindow()
      if (window && !window.isDestroyed()) window.webContents.send(CHANNELS.chatEvent, envelope)
    },
    readKey: (providerId) => getKeystore().read(providerId),
    store,
    resolveProvider: getProvider,
    fetch: mainFetch,
    // Shared with the context-inspector preview below so the two never disagree
    // about what "fits".
    maxContextTokens: MAX_CONTEXT_TOKENS,
    // Enables agentic edits (gated writes) when a turn opts in.
    workspace: getWorkspace(),
    // Resolves the turn's confinement root from its own session's project.
    projects: getProjectStore(),
    // Contributes MCP server tools to agent turns (gated per call).
    mcp: getMcpManager(),
  })

  ipcMain.handle(CHANNELS.mcpList, () => getMcpManager().list())
  ipcMain.handle(CHANNELS.mcpAdd, withZodMapping(async (_e, raw: unknown) => {
    await getMcpManager().addServer(McpAddSchema.parse(raw))
    return getMcpManager().list()
  }))
  ipcMain.handle(CHANNELS.mcpRemove, withZodMapping(async (_e, raw: unknown) => {
    await getMcpManager().removeServer(McpIdSchema.parse(raw).id)
    return getMcpManager().list()
  }))
  ipcMain.handle(CHANNELS.mcpSetEnabled, withZodMapping(async (_e, raw: unknown) => {
    const { id, enabled } = McpSetEnabledSchema.parse(raw)
    await getMcpManager().setEnabled(id, enabled)
    return getMcpManager().list()
  }))

  const git = new GitService(getWorkspace())
  ipcMain.handle(CHANNELS.gitStatus, () => git.status())
  ipcMain.handle(CHANNELS.gitDiff, withZodMapping((_e, raw: unknown) => git.diff(GitDiffSchema.parse(raw).path)))

  ipcMain.handle(CHANNELS.chatSend, withZodMapping((_e, raw: unknown) => engine.start(SendSchema.parse(raw))))
  ipcMain.handle(CHANNELS.chatAbort, withZodMapping((_e, raw: unknown) => {
    engine.abort(AbortSchema.parse(raw).streamId)
  }))
  ipcMain.handle(CHANNELS.chatRace, withZodMapping((_e, raw: unknown) => engine.startRace(RaceSchema.parse(raw))))
  ipcMain.handle(CHANNELS.chatChooseWinner, withZodMapping((_e, raw: unknown) => {
    const { raceId, columnId } = ChooseWinnerSchema.parse(raw)
    return engine.chooseRaceWinner(raceId, columnId)
  }))
  ipcMain.handle(CHANNELS.chatToolDecision, withZodMapping((_e, raw: unknown) => {
    const { callId, action, content, trustTurn } = ToolDecisionSchema.parse(raw)
    engine.resolveApproval(callId, action === 'edited' ? { action, content: content ?? '' } : { action }, trustTurn)
  }))
  ipcMain.handle(CHANNELS.providersList, () => listProviders())
  ipcMain.handle(CHANNELS.sessionsList, () => store.list())
  ipcMain.handle(CHANNELS.sessionLoad, withZodMapping((_e, raw: unknown) => store.load(SessionIdSchema.parse(raw).id)))
  ipcMain.handle(
    CHANNELS.sessionCreate,
    withZodMapping((_e, raw: unknown) => store.create(SessionCreateSchema.parse(raw).title)),
  )
  ipcMain.handle(
    CHANNELS.sessionDelete,
    withZodMapping((_e, raw: unknown) => store.remove(SessionIdSchema.parse(raw).id)),
  )
  ipcMain.handle(
    CHANNELS.sessionRename,
    withZodMapping((_e, raw: unknown) => {
      const { id, title } = SessionRenameSchema.parse(raw)
      return store.rename(id, title)
    }),
  )
  ipcMain.handle(CHANNELS.sessionSetPinned, withZodMapping((_e, raw: unknown) => {
    const { id, pinned } = SessionSetPinnedSchema.parse(raw)
    return store.setPinned(id, pinned)
  }))
  ipcMain.handle(CHANNELS.sessionSetArchived, withZodMapping((_e, raw: unknown) => {
    const { id, archived } = SessionSetArchivedSchema.parse(raw)
    return store.setArchived(id, archived)
  }))
  ipcMain.handle(CHANNELS.sessionSetTags, withZodMapping((_e, raw: unknown) => {
    const { id, tags } = SessionSetTagsSchema.parse(raw)
    return store.setTags(id, tags)
  }))
  ipcMain.handle(CHANNELS.sessionBranch, withZodMapping((_e, raw: unknown) => {
    const { sourceId, uptoId, title } = SessionBranchSchema.parse(raw)
    return store.branch(sourceId, uptoId, title)
  }))
  ipcMain.handle(CHANNELS.sessionTruncateFrom, withZodMapping((_e, raw: unknown) => {
    const { id, messageId } = SessionMessageRefSchema.parse(raw)
    return store.truncateFrom(id, messageId)
  }))
  ipcMain.handle(CHANNELS.sessionEditMessage, withZodMapping((_e, raw: unknown) => {
    const { id, messageId, content } = SessionEditMessageSchema.parse(raw)
    return store.editMessage(id, messageId, content)
  }))
  ipcMain.handle(CHANNELS.chatPreview, withZodMapping(async (_e, raw: unknown): Promise<ContextPreview> => {
    const { id } = SessionIdSchema.parse(raw)
    const messages = await store.load(id)
    const budgeted = applyContextBudget(messages, MAX_CONTEXT_TOKENS)
    const includedIds = new Set(budgeted.messages.map((m) => m.id))
    const entries: ContextPreviewEntry[] = messages.map((m) => ({
      id: m.id,
      role: m.role,
      tokens: estimateTokens(m.content),
      included: includedIds.has(m.id),
      preview: m.content.slice(0, 100),
    }))
    const includedTokens = entries.filter((e) => e.included).reduce((n, e) => n + e.tokens, 0)
    const totalTokens = entries.reduce((n, e) => n + e.tokens, 0)
    return { entries, includedTokens, totalTokens, omittedCount: budgeted.omittedCount, budget: MAX_CONTEXT_TOKENS }
  }))
  ipcMain.handle(CHANNELS.settingsGet, () => getSettingsStore().get())
  ipcMain.handle(CHANNELS.settingsSet, withZodMapping((_e, raw: unknown) => {
    return getSettingsStore().set(SettingsPatchSchema.parse(raw))
  }))
  ipcMain.handle(CHANNELS.modelsList, withZodMapping(async (_e, raw: unknown) => {
    const { providerId } = ModelsListSchema.parse(raw)
    const provider = getProvider(providerId)
    const apiKey = await getKeystore().read(providerId)
    // Mirrors the stream-engine's guard (Task 8): providers that declare
    // `requiresKey: false` (local runtimes, the E2E fake) must be listable
    // with no stored credential. Only bail out early for providers that
    // actually need one.
    if (provider.requiresKey && !apiKey) return []
    return provider.listModels({ apiKey: apiKey ?? '', fetch: mainFetch })
  }))
}

let updater: UpdaterService | undefined

export function getUpdater(): UpdaterService | undefined {
  return updater
}

/**
 * Wires the updater to IPC. The renderer can read state, request a check,
 * toggle the preference, and install — but it cannot influence WHERE the
 * updater looks; owner/repo live in src/main/updater/policy.ts.
 *
 * Registration is entirely SYNCHRONOUS on purpose. An earlier version of this
 * function awaited the persisted `updatesEnabled` read before registering any
 * `ipcMain.handle` channel; since index.ts calls this as
 * `void registerUpdateHandlers(...)` (never awaited), a renderer that mounts
 * fast enough could invoke `updates:get` before the handler existed at all,
 * surfacing "No handler registered" as a spurious startup error. Constructing
 * the service and registering every channel here — before any `await` — makes
 * that race impossible: by the time this function returns, `updates:get`
 * already has a real UpdaterService behind it.
 */
export function registerUpdateHandlers(
  getWindow: () => BrowserWindow | undefined,
): void {
  const settings = getSettingsStore()
  const fake = process.env['MODELITH_FAKE_UPDATER'] === '1'

  // `enabled: true` is the same fallback used below once the persisted value
  // loads and turns out to be unset — so a renderer that reads state before
  // the settings file has been read back sees exactly what it would see once
  // that read completes anyway, in the common case.
  const service = new UpdaterService({
    backend: selectBackend({
      platform: process.platform,
      isPackaged: app.isPackaged,
      fake,
      // Injected here, not imported inside backend.ts, so electron-updater
      // never reaches the unit-test runner.
      electronBackendFactory: () => new ElectronUpdaterBackend(),
    }),
    currentVersion: app.getVersion(),
    // The fake backend drives the e2e suite, which runs unpackaged; force the
    // capability on so the full download → ready path is exercised.
    canAutoInstall: fake || canAutoInstall(process.platform, app.isPackaged),
    enabled: true,
    emit: (state) => {
      const window = getWindow()
      if (window && !window.isDestroyed()) {
        window.webContents.send(CHANNELS.updatesChanged, state)
      }
    },
    persistEnabled: async (value) => { await settings.set({ updatesEnabled: value }) },
  })
  updater = service

  // Set the instant an explicit `updates:set-enabled` call is received (see
  // below), synchronously, before anything else in that handler runs. Guards
  // the persisted-value application further down: once the user has made an
  // explicit choice, a slow settings read that resolves afterward must never
  // clobber it with a possibly-stale value.
  let userToggled = false

  ipcMain.handle(CHANNELS.updatesGet, () => service.getState())
  ipcMain.handle(CHANNELS.updatesCheck, () => service.check(true))
  ipcMain.handle(CHANNELS.updatesInstall, () => {
    // The decision (install vs. open-release vs. noop) is a pure function in
    // policy.ts, unit-tested directly — this handler is just a thin shell
    // that acts on it. The URL, when present, was built by
    // policy.releaseUrlFor from a hardcoded repo constant; it never came from
    // a response body or from the renderer.
    const action = resolveInstallAction(service.getState())
    if (action.type === 'open-release') {
      // openExternal can reject (e.g. no default browser configured); that
      // must not become an unhandled promise rejection.
      void shell.openExternal(action.url).catch(() => {})
      return
    }
    if (action.type === 'install') service.install()
  })
  ipcMain.handle(CHANNELS.updatesSetEnabled, withZodMapping(async (_e, raw: unknown) => {
    userToggled = true
    await service.setEnabled(UpdatesSetEnabledSchema.parse(raw).enabled)
  }))

  // Started with the enabled: true default above — never blocked on the
  // settings read below, so a slow or failing disk read never leaves the
  // service unstarted.
  service.start()

  // Load the persisted preference in the background. The handlers above
  // already exist and the service is already running with its default, so
  // this can take as long as it needs to without ever exposing a window where
  // `updates:get` has no handler, or where it would return undefined.
  void settings.get()
    .then((all) => {
      const stored = all['updatesEnabled']
      if (typeof stored !== 'boolean') return
      // An explicit setEnabled() the user triggered (via IPC) while this read
      // was in flight reflects their current, real intent — it must win over
      // a persisted value that may now be stale. userToggled is set
      // synchronously at the top of that handler, before any `await`, so this
      // check is race-free regardless of which promise settles first.
      if (userToggled) return
      if (stored === service.getState().enabled) return
      // Reuses setEnabled rather than patching state directly so the
      // start()/stop() scheduling stays correct (e.g. stored: false must stop
      // the timers service.start() above already armed). It re-persists the
      // same value it just read, which is a harmless no-op write.
      void service.setEnabled(stored)
    })
    .catch(() => {
      // A failed settings read must not throw across this background chain,
      // and must not leave the service unstarted — it already started above
      // with the same enabled: true fallback used when the key was never
      // written, which is the correct fallback here too.
    })
}
