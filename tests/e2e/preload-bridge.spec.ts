import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launchApp } from './launch.js'

let app: ElectronApplication

test.beforeAll(async () => { app = await launchApp() })
test.afterAll(async () => { await app.close() })

test('window.openCoder.appInfo() resolves with a version and platform', async () => {
  const page = await app.firstWindow()
  const info = await page.evaluate(() => window.openCoder.appInfo())
  expect(typeof info.version).toBe('string')
  expect(typeof info.platform).toBe('string')
})

test('window.openCoder exposes no key-reading method', async () => {
  const page = await app.firstWindow()
  const keyMethodNames = await page.evaluate(() => Object.keys(window.openCoder.keys))
  expect(keyMethodNames).toEqual(expect.arrayContaining(['set', 'delete', 'has']))
  expect(keyMethodNames).not.toContain('get')
  expect(keyMethodNames).not.toContain('read')
})
