import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launchApp } from './launch.js'

let app: ElectronApplication
test.beforeAll(async () => { app = await launchApp() })
test.afterAll(async () => { await app.close() })

test('renders a frameless title bar', async () => {
  const page = await app.firstWindow()
  await expect(page.getByTestId('titlebar')).toBeVisible()
})

test('exposes window controls through the bridge', async () => {
  const page = await app.firstWindow()
  const shape = await page.evaluate(() => Object.keys(window.modelith.window).sort())
  expect(shape).toEqual([
    'about', 'close', 'isMaximized', 'maximizeToggle', 'minimize',
    'onMaximizedChange', 'openChatsFolder', 'quit',
  ])
})

test('the app menu opens and lists the real actions', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('app-menu-button').click()
  const dropdown = page.getByTestId('app-menu-dropdown')
  await expect(dropdown).toBeVisible()
  await expect(dropdown).toContainText('New chat')
  await expect(dropdown).toContainText('Settings')
  await expect(dropdown).toContainText('Quit Modelith')
  // Deliberately omitted because the features do not exist yet.
  await expect(dropdown).not.toContainText('New window')
  await expect(dropdown).not.toContainText('Export chat')
})
