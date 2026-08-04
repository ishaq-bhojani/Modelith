import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launchApp } from './launch.js'

let app: ElectronApplication

// MODELITH_FAKE_UPDATER swaps in a backend that reports version 99.0.0 and
// "downloads" instantly, mirroring the MODELITH_FAKE_PROVIDER pattern. Without
// it the app runs unpackaged and deliberately never checks at all.
test.beforeAll(async () => { app = await launchApp({ MODELITH_FAKE_UPDATER: '1' }) })
test.afterAll(async () => { await app.close() })

test('a manual check surfaces a ready update in the chip', async () => {
  const page = await app.firstWindow()
  await page.evaluate(() => window.modelith.updates.check())
  const chip = page.getByTestId('update-chip')
  await expect(chip).toBeVisible()
  await expect(chip).toContainText(/restart/i)
})

test('the chip can be dismissed', async () => {
  const page = await app.firstWindow()
  await page.evaluate(() => window.modelith.updates.check())
  await page.getByTestId('update-chip-dismiss').click()
  await expect(page.getByTestId('update-chip')).toHaveCount(0)
})

test('the Settings toggle persists the preference', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('open-settings').click()
  await page.getByTestId('settings-tab-updates').click()
  const toggle = page.getByTestId('updates-toggle')
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  const enabled = await page.evaluate(async () => (await window.modelith.updates.getState()).enabled)
  expect(enabled).toBe(false)
})
