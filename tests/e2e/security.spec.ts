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

test('the packaged renderer carries a restrictive CSP', async () => {
  const page = await app.firstWindow()
  const csp = await page.evaluate(
    () =>
      document
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute('content') ?? null,
  )
  expect(csp).toContain("script-src 'self'")
  expect(csp).toContain("connect-src 'self'")
  expect(csp).toContain("object-src 'none'")
})

test('the CSP actually blocks an injected inline script', async () => {
  const page = await app.firstWindow()
  // Proves the policy is enforced, not merely present in the document.
  const executed = await page.evaluate(() => {
    const marker = '__csp_probe__'
    const script = document.createElement('script')
    script.textContent = `window.${marker} = true`
    document.body.appendChild(script)
    return Boolean((window as unknown as Record<string, unknown>)[marker])
  })
  expect(executed).toBe(false)
})
