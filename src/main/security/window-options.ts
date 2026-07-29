import { join } from 'node:path'
import type { BrowserWindowConstructorOptions } from 'electron'

/**
 * The single source of truth for window security settings.
 * The invariant test and the production window read this same object,
 * so a security setting cannot drift between what is tested and what ships.
 */
export const WINDOW_OPTIONS: BrowserWindowConstructorOptions = {
  width: 1280,
  height: 860,
  minWidth: 720,
  minHeight: 480,
  show: false,
  backgroundColor: '#101014',
  webPreferences: {
    preload: join(import.meta.dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webviewTag: false,
    spellcheck: false,
  },
}
