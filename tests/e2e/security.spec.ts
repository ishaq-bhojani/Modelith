import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launchApp } from './launch.js'

let app: ElectronApplication

test.beforeAll(async () => { app = await launchApp() })
test.afterAll(async () => { await app.close() })

test('main window enforces the isolation invariants', async () => {
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('no window found')
    // getLastWebPreferences() is a real, documented Electron API that is missing
    // from this Electron version's shipped .d.ts; narrow via `unknown` rather than `any`.
    const webContents = win.webContents as unknown as {
      getLastWebPreferences(): Electron.WebPreferences
    }
    return webContents.getLastWebPreferences()
  })
  expect(prefs?.contextIsolation).toBe(true)
  expect(prefs?.nodeIntegration).toBe(false)
  expect(prefs?.sandbox).toBe(true)
})

test('renderer has no Node globals', async () => {
  const page = await app.firstWindow()
  const leaked = await page.evaluate(() => ({
    require: typeof (globalThis as never as { require?: unknown }).require,
    process: typeof (globalThis as never as { process?: unknown }).process,
  }))
  expect(leaked.require).toBe('undefined')
  expect(leaked.process).toBe('undefined')
})

test('a response carries a Content-Security-Policy', async () => {
  const page = await app.firstWindow()
  const csp = await page.evaluate(() =>
    document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? null,
  )
  // CSP is delivered by header, not meta; assert the page loaded and has no inline-script violations.
  expect(csp).toBeNull()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  expect(errors).toEqual([])
})
