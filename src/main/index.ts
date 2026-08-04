import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { WINDOW_OPTIONS } from './security/window-options.js'
import { applySecurityPolicy } from './security/csp.js'
import { registerHandlers, registerSecretHandlers, registerChatHandlers, registerWorkspaceHandlers, registerUpdateHandlers, getUpdater, getMcpManager } from './ipc/handlers.js'
import { registerWindowHandlers, installAppMenu } from './window/controls.js'
import { CHANNELS } from '../shared/ipc.js'

// Portable-mode override. Keeps E2E runs out of the developer's real app data,
// and lets users run from a USB stick. Must be set before anything reads the path.
const portableDir = process.env['MODELITH_USER_DATA']
if (portableDir) app.setPath('userData', portableDir)

// Tracks the current main window so the chat IPC handlers (registered once,
// below) always emit to whichever window is presently live, including after
// `activate` replaces a closed window with a new one.
let mainWindow: BrowserWindow | undefined

function createWindow(): BrowserWindow {
  const window = new BrowserWindow(WINDOW_OPTIONS)
  applySecurityPolicy(window.webContents.session, window)

  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (devServer) void window.loadURL(devServer)
  else void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))

  window.once('ready-to-show', () => window.show())

  // Keep the renderer's maximise/restore icon in sync with the real window
  // state, including when the user maximises via a double-click on the drag
  // strip or an OS gesture rather than the custom control.
  const emitMaximized = (isMaximized: boolean) => {
    if (!window.isDestroyed()) window.webContents.send(CHANNELS.windowMaximizedChanged, isMaximized)
  }
  window.on('maximize', () => emitMaximized(true))
  window.on('unmaximize', () => emitMaximized(false))

  mainWindow = window
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  return window
}

void app.whenReady().then(() => {
  registerHandlers()
  registerSecretHandlers()
  createWindow()
  // Registered once: ipcMain.handle() throws if a channel is bound twice, and
  // `activate` can create new windows over the lifetime of the app.
  registerChatHandlers(() => mainWindow)
  registerWorkspaceHandlers(() => mainWindow)
  // Connect any configured MCP servers in the background; failures surface as
  // per-server error status in the panel, never as a startup hang.
  void getMcpManager().init()
  registerWindowHandlers(() => mainWindow)
  installAppMenu(() => mainWindow)
  // Synchronous: registers every updates:* channel and starts the service
  // before this call returns, so a renderer mounting right after can never
  // race ahead of a handler existing. The persisted enabled/disabled
  // preference and periodic checks load and run in the background.
  registerUpdateHandlers(() => mainWindow)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  getUpdater()?.stop()
})
