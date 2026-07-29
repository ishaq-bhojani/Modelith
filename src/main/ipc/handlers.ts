import { app, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { join } from 'node:path'
import {
  CHANNELS,
  KeyRefSchema,
  KeySetSchema,
  SendSchema,
  AbortSchema,
  SessionIdSchema,
  SessionCreateSchema,
  ModelsListSchema,
} from '../../shared/ipc.js'
import type { AppInfo } from '../../shared/ipc.js'
import { Keystore } from '../secrets/keystore.js'
import { electronCrypto } from '../secrets/electron-crypto.js'
import { SessionStore } from '../sessions/store.js'
import { StreamEngine } from '../chat/stream-engine.js'
import { getProvider, listProviders, mainFetch } from '../providers/registry.js'

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

export function registerHandlers(): void {
  ipcMain.handle(CHANNELS.appInfo, (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
  }))
}

export function registerSecretHandlers(): void {
  ipcMain.handle(CHANNELS.keySet, async (_e, raw: unknown) => {
    const { providerId, apiKey } = KeySetSchema.parse(raw)
    await getKeystore().set(providerId, apiKey)
  })
  ipcMain.handle(CHANNELS.keyDelete, async (_e, raw: unknown) => {
    await getKeystore().delete(KeyRefSchema.parse(raw).providerId)
  })
  ipcMain.handle(CHANNELS.keyHas, async (_e, raw: unknown) => {
    return getKeystore().has(KeyRefSchema.parse(raw).providerId)
  })
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
  })

  ipcMain.handle(CHANNELS.chatSend, (_e, raw: unknown) => engine.start(SendSchema.parse(raw)))
  ipcMain.handle(CHANNELS.chatAbort, (_e, raw: unknown) => {
    engine.abort(AbortSchema.parse(raw).streamId)
  })
  ipcMain.handle(CHANNELS.providersList, () => listProviders())
  ipcMain.handle(CHANNELS.sessionsList, () => store.list())
  ipcMain.handle(CHANNELS.sessionLoad, (_e, raw: unknown) => store.load(SessionIdSchema.parse(raw).id))
  ipcMain.handle(CHANNELS.sessionCreate, (_e, raw: unknown) => store.create(SessionCreateSchema.parse(raw).title))
  ipcMain.handle(CHANNELS.sessionDelete, (_e, raw: unknown) => store.remove(SessionIdSchema.parse(raw).id))
  ipcMain.handle(CHANNELS.modelsList, async (_e, raw: unknown) => {
    const { providerId, baseUrl } = ModelsListSchema.parse(raw)
    const provider = getProvider(providerId)
    const apiKey = await getKeystore().read(providerId)
    // Mirrors the stream-engine's guard (Task 8): providers that declare
    // `requiresKey: false` (local runtimes, the E2E fake) must be listable
    // with no stored credential. Only bail out early for providers that
    // actually need one.
    if (provider.requiresKey && !apiKey) return []
    return provider.listModels({ apiKey: apiKey ?? '', ...(baseUrl ? { baseUrl } : {}), fetch: mainFetch })
  })
}
