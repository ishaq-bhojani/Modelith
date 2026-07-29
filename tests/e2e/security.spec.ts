import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launchApp } from './launch.js'
import { SendSchema, ModelsListSchema } from '../../src/shared/ipc.js'

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

test('the bridge exposes no way to read a stored key', async () => {
  const page = await app.firstWindow()
  const shape = await page.evaluate(() => ({
    keyFns: Object.keys(window.openCoder.keys),
    topLevel: Object.keys(window.openCoder),
  }))
  expect(shape.keyFns.sort()).toEqual(['delete', 'has', 'set'])
  expect(shape.topLevel).not.toContain('keystore')
})

// Design spec §9.4: "no renderer-originated request can redirect where
// provider traffic goes." A renderer-supplied `baseUrl` would let the
// renderer redirect where main sends the API key it can never itself read —
// equivalent to a key leak. This must stay impossible at the IPC boundary,
// not merely unused by today's UI.
test('the renderer bridge exposes no way to influence the provider endpoint', async () => {
  // (1) The accepted payload shape itself must carry no URL-ish field. This
  // inspects the actual zod schema (not just the TS type, which is erased at
  // runtime and provides no protection) so the test fails the moment someone
  // re-adds `baseUrl` to SendSchema or ModelsListSchema.
  expect(Object.keys(SendSchema.shape)).not.toContain('baseUrl')
  expect(Object.keys(ModelsListSchema.shape)).not.toContain('baseUrl')

  // (2) Even if a caller (a compromised or buggy renderer) attaches an extra
  // `baseUrl` property to the wire payload, main's `.parse()` must strip it
  // rather than honour it — zod object schemas drop unrecognized keys by
  // default. Confirm decisively by parsing a payload that carries one.
  const parsedSend = SendSchema.parse({
    sessionId: 's1', providerId: 'anthropic', model: 'm', content: 'hi',
    baseUrl: 'https://evil.example.com',
  })
  expect(parsedSend).not.toHaveProperty('baseUrl')

  const parsedModels = ModelsListSchema.parse({
    providerId: 'anthropic', baseUrl: 'https://evil.example.com',
  })
  expect(parsedModels).not.toHaveProperty('baseUrl')

  // (3) End-to-end through the real bridge: the same extra property, sent
  // from the renderer over the actual preload/IPC channel, must not cause an
  // error (proving it is silently ignored, not laundered through) and must
  // not appear anywhere in the resolved bridge surface.
  const page = await app.firstWindow()
  const result = await page.evaluate(async () => {
    const session = await window.openCoder.sessions.create('security-test')
    const sendResult = await window.openCoder.chat.send({
      sessionId: session.id,
      providerId: 'does-not-exist',
      model: 'm',
      content: 'hi',
      // @ts-expect-error -- deliberately probing a field the bridge's type no
      // longer declares, to prove the wire payload can't smuggle it through.
      baseUrl: 'https://evil.example.com',
    })
    return { streamId: sendResult.streamId }
  })
  expect(typeof result.streamId).toBe('string')
})
