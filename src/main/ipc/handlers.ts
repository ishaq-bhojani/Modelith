import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { CHANNELS, KeyRefSchema, KeySetSchema } from '../../shared/ipc.js'
import type { AppInfo } from '../../shared/ipc.js'
import { Keystore } from '../secrets/keystore.js'
import { electronCrypto } from '../secrets/electron-crypto.js'

// Lazy singleton: `app.getPath('userData')` must not be evaluated until after
// index.ts has applied the OPEN_CODER_USER_DATA portable-mode override. Since
// ES module imports are evaluated before any statement in the importing module,
// constructing this at module scope would read the path too early and break
// E2E isolation. Constructing on first use (from inside registerSecretHandlers,
// called within app.whenReady().then(...)) keeps ordering correct.
let instance: Keystore | undefined

export function getKeystore(): Keystore {
  instance ??= new Keystore(electronCrypto, join(app.getPath('userData'), 'keys.json'))
  return instance
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
