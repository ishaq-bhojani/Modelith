import { app, ipcMain } from 'electron'
import { CHANNELS } from '../../shared/ipc.js'
import type { AppInfo } from '../../shared/ipc.js'

export function registerHandlers(): void {
  ipcMain.handle(CHANNELS.appInfo, (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
  }))
}
