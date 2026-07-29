import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { WINDOW_OPTIONS } from './security/window-options.js'
import { applySecurityPolicy } from './security/csp.js'

// Portable-mode override. Keeps E2E runs out of the developer's real app data,
// and lets users run from a USB stick. Must be set before anything reads the path.
const portableDir = process.env['OPEN_CODER_USER_DATA']
if (portableDir) app.setPath('userData', portableDir)

function createWindow(): BrowserWindow {
  const window = new BrowserWindow(WINDOW_OPTIONS)
  applySecurityPolicy(window.webContents.session, window)

  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (devServer) void window.loadURL(devServer)
  else void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))

  window.once('ready-to-show', () => window.show())
  return window
}

void app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
