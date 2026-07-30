import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launchApp } from './launch.js'

let app: ElectronApplication
test.beforeAll(async () => { app = await launchApp({ OPEN_CODER_FAKE_PROVIDER: '1' }) })
test.afterAll(async () => { await app.close() })

test('the command palette opens with ⌘K and filters', async () => {
  const page = await app.firstWindow()
  // Ensure the webContents has focus so the window keydown listener receives it.
  await page.getByTestId('sidebar').click()
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByTestId('palette-input')).toBeVisible()
  await page.getByTestId('palette-input').fill('settings')
  await expect(page.getByTestId('palette-list')).toContainText('Open settings')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('palette-input')).not.toBeVisible()
})

test('the secret guard intercepts a pasted key before sending', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('new-session').click()
  await page.getByTestId('composer-input')
    .fill('here is my key sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD1234')
  await page.getByTestId('composer-send').click()
  // Send is paused; a confirm gate appears instead of the message going out.
  await expect(page.getByTestId('secret-send-anyway')).toBeVisible()
  await page.getByTestId('secret-cancel').click()
  await expect(page.getByTestId('secret-send-anyway')).not.toBeVisible()
  // The draft is preserved on cancel.
  await expect(page.getByTestId('composer-input')).toContainText('sk-')
})

test('a clean message sends without the secret gate', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('composer-input').fill('just a normal question')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('secret-send-anyway')).not.toBeVisible()
  await expect(page.getByTestId('transcript')).toContainText('just a normal question')
})

test('the side thread opens as its own drawer', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('side-thread-open').click()
  await expect(page.getByTestId('side-thread')).toBeVisible()
  await expect(page.getByTestId('side-thread')).toContainText('nothing here touches the main chat')
  await page.getByTestId('side-thread-input').fill('a quick aside')
  await page.getByTestId('side-thread').getByLabel('Send').click()
  await expect(page.getByTestId('side-thread')).toContainText('a quick aside')
})
