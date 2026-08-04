import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindowConstructorOptions } from 'electron'

/**
 * Platform-conditional window chrome (design "Windows 11 — frameless titlebar"
 * and the macOS traffic-light inset):
 *
 * - macOS uses `hiddenInset`, so the native traffic lights remain (accessible,
 *   familiar) while the rest of the title bar becomes app content. The renderer
 *   insets its top 40px and marks that strip draggable.
 * - Windows and Linux go fully frameless; the renderer draws its own title bar
 *   with minimise / maximise / close controls and folds the old OS menu into a
 *   ⋯ button.
 *
 * These are BrowserWindow-level options, not webPreferences, so none of them
 * touch the isolation invariants (contextIsolation / nodeIntegration / sandbox)
 * that the security E2E test guards.
 */
const isMac = process.platform === 'darwin'

const chrome: Pick<
  BrowserWindowConstructorOptions,
  'frame' | 'titleBarStyle' | 'trafficLightPosition'
> = isMac
  ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 13 } }
  : { frame: false }

/**
 * The single source of truth for window security settings.
 * The invariant test and the production window read this same object,
 * so a security setting cannot drift between what is tested and what ships.
 */
/**
 * The window/taskbar icon while the app is RUNNING.
 *
 * A packaged build gets this from the executable's own embedded icon, which
 * electron-builder generates from build/icon.svg — nothing to do there. But in
 * development there is no packaged executable, so Electron falls back to its
 * own default icon and the taskbar shows Electron's logo no matter what is in
 * build/. `icon` is what fixes that, and it needs a raster: it will not accept
 * SVG.
 *
 * Resolved from the repo root because `import.meta.dirname` is `out/main` once
 * electron-vite has built. Guarded by existsSync so a missing PNG degrades to
 * the default icon rather than throwing at startup.
 */
const devIcon = join(import.meta.dirname, '../../build/icon.png')

export const WINDOW_OPTIONS: BrowserWindowConstructorOptions = {
  width: 1280,
  height: 860,
  minWidth: 720,
  minHeight: 480,
  show: false,
  backgroundColor: '#000000',
  ...(existsSync(devIcon) ? { icon: devIcon } : {}),
  ...chrome,
  webPreferences: {
    preload: join(import.meta.dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webviewTag: false,
    spellcheck: false,
  },
}
