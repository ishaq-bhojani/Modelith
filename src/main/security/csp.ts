import { shell } from 'electron'
import type { BrowserWindow, Session } from 'electron'

/**
 * Builds the renderer's Content-Security-Policy.
 *
 * The renderer is loaded two different ways, and they need different policies.
 *
 * **Production** (`isDev: false`) loads `index.html` over `file://`, where
 * `webRequest.onHeadersReceived` never fires — so that build is governed by the
 * `<meta http-equiv="Content-Security-Policy">` tag in `index.html`, not by this
 * header. The two must stay identical; a unit test asserts they match.
 *
 * **Development** (`isDev: true`) is served over `http://` by Vite, so this
 * header does apply. Vite injects an inline React Refresh preamble into
 * `<head>`; a `script-src` without `'unsafe-inline'` blocks it,
 * `@vitejs/plugin-react` then throws "can't detect preamble", and React never
 * mounts — the window renders completely blank. Vite's HMR channel likewise
 * needs `ws:` in `connect-src`.
 *
 * Both relaxations are development-only and never reach a shipped build.
 */
/**
 * CSP hash of the artifact-canvas harness bootstrap. The harness runs in an
 * `srcdoc` iframe, which inherits THIS policy; allow-listing exactly that one
 * inline script by hash lets it run without opening `'unsafe-inline'` to the
 * whole renderer. Kept in sync with the script by a unit test (see harness.ts).
 */
const HARNESS_SCRIPT_HASH = "'sha256-tqZDCWU/6winVZ/e07XEDI44DtUYwsri9yTPsWBrFIs='"

export function buildCsp(isDev: boolean): string {
  return [
    "default-src 'self'",
    isDev ? "script-src 'self' 'unsafe-inline'" : `script-src 'self' ${HARNESS_SCRIPT_HASH}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    isDev ? "connect-src 'self' ws:" : "connect-src 'self'",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

export function applySecurityPolicy(session: Session, window: BrowserWindow): void {
  // electron-vite sets this only while serving the renderer from its dev server.
  const csp = buildCsp(Boolean(process.env['ELECTRON_RENDERER_URL']))

  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
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
