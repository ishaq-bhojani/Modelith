import { shell } from 'electron'
import type { BrowserWindow, Session } from 'electron'

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export function applySecurityPolicy(session: Session, window: BrowserWindow): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] },
    })
  })

  // Deny every permission request; v0 needs none.
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))

  // The window never navigates away from its own document.
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  // External links open in the system browser, never in-app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
}
