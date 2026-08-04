import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launchApp } from './launch.js'

let app: ElectronApplication
test.beforeAll(async () => { app = await launchApp({ MODELITH_FAKE_PROVIDER: '1' }) })
test.afterAll(async () => { await app.close() })

test('pinning moves a session into the Pinned group', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('new-session').click()
  const row = page.locator('.session-row').first()
  await row.hover()
  await row.getByRole('button', { name: /^Pin / }).click()
  await expect(page.locator('.session-group', { hasText: 'Pinned' })).toBeVisible()
})

test('the context inspector opens and reports the budget', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('inspect-context').click()
  const inspector = page.getByTestId('context-inspector')
  await expect(inspector).toBeVisible()
  await expect(inspector).toContainText('tokens')
  // Close it — the drawer overlaps the composer, and the shared app instance
  // would otherwise leave the send button covered for the next test.
  await page.getByTestId('inspect-context').click()
  await expect(inspector).not.toBeVisible()
})

test('forking a message creates a second session', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('new-session').click()
  await page.getByTestId('composer-input').fill('first turn')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('transcript')).toContainText('Hello from the fake provider', { timeout: 10_000 })

  const before = await page.locator('.session-row').count()
  // The user message's fork control (canonical id available after the turn's
  // post-done refresh).
  const userMsg = page.locator('.msg-user-group').first()
  await userMsg.hover()
  await userMsg.getByTestId('fork-message').click()
  await expect.poll(async () => page.locator('.session-row').count()).toBeGreaterThan(before)
})

test('creating a mode lists it in the composer mode menu', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('open-settings').click()
  await page.getByTestId('settings-tab-modes').click()
  await page.getByTestId('mode-name').fill('Terse')
  await page.getByTestId('mode-prompt').fill('Answer in one sentence.')
  await page.getByTestId('mode-save').click()
  await page.getByTestId('settings-close').click()
  await page.getByTestId('mode-menu-button').click()
  await expect(page.getByTestId('mode-dropdown')).toContainText('Terse')
})
