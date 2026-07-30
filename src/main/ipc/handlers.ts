import { app, ipcMain } from 'electron'
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
} from '../../shared/ipc.js'
import type { AppInfo } from '../../shared/ipc.js'
import type { ContextPreview, ContextPreviewEntry } from '../../shared/types.js'
import { Keystore } from '../secrets/keystore.js'
import { electronCrypto } from '../secrets/electron-crypto.js'
import { SessionStore } from '../sessions/store.js'
import { AppSettingsStore } from '../settings/store.js'
import { Workspace } from '../workspace/service.js'
import { StreamEngine } from '../chat/stream-engine.js'
import { applyContextBudget, estimateTokens } from '../chat/context-budget.js'
import { getProvider, listProviders, mainFetch } from '../providers/registry.js'

const MAX_CONTEXT_TOKENS = 96_000

// Lazy singletons: `app.getPath('userData')` must not be evaluated until after
// index.ts has applied the OPEN_CODER_USER_DATA portable-mode override. Since
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
  const workspace = new Workspace(getSettingsStore(), getWindow)
  ipcMain.handle(CHANNELS.workspacePick, () => workspace.pick())
  ipcMain.handle(CHANNELS.workspaceCurrent, () => workspace.current())
  ipcMain.handle(CHANNELS.workspaceTree, () => workspace.tree())
  ipcMain.handle(CHANNELS.workspaceRead, withZodMapping((_e, raw: unknown) => {
    return workspace.read(WorkspaceReadSchema.parse(raw).relPath)
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
  })

  ipcMain.handle(CHANNELS.chatSend, withZodMapping((_e, raw: unknown) => engine.start(SendSchema.parse(raw))))
  ipcMain.handle(CHANNELS.chatAbort, withZodMapping((_e, raw: unknown) => {
    engine.abort(AbortSchema.parse(raw).streamId)
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
