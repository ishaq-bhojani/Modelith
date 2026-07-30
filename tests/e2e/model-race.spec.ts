import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launchApp } from './launch.js'

let app: ElectronApplication
test.beforeEach(async () => { app = await launchApp({ OPEN_CODER_FAKE_PROVIDER: '1' }) })
test.afterEach(async () => { await app.close() })

async function setUpRace(page: Awaited<ReturnType<ElectronApplication['firstWindow']>>) {
  await page.getByTestId('new-session').click()
  // Wait until a model is selected so race targets inherit it.
  await expect(page.getByTestId('model-picker')).toBeVisible().catch(() => {})
  await page.getByTestId('toggle-race').click()
  await expect(page.getByTestId('race-bar')).toBeVisible()
  await page.getByTestId('race-add').click()
  await page.getByTestId('race-add').click()
  await expect(page.getByTestId('race-target')).toHaveCount(2)
  await page.getByTestId('composer-input').fill('race this prompt')
}

test('a race streams parallel columns and picking one persists it', async () => {
  const page = await app.firstWindow()
  await setUpRace(page)
  await page.getByTestId('race-start').click()

  await expect(page.getByTestId('race-view')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('race-col')).toHaveCount(2)
  // Both columns stream the fake reply; Pick enables when a column finishes.
  const firstPick = page.getByTestId('race-pick').first()
  await expect(firstPick).toBeEnabled({ timeout: 10_000 })
  await firstPick.click()

  // The race collapses and the chosen reply becomes the turn's answer.
  await expect(page.getByTestId('race-view')).toHaveCount(0)
  await expect(page.getByTestId('transcript')).toContainText('Hello from the fake provider', { timeout: 8000 })
})

test('cancelling a race persists nothing new', async () => {
  const page = await app.firstWindow()
  await setUpRace(page)
  await page.getByTestId('race-start').click()
  await expect(page.getByTestId('race-view')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('race-cancel').click()
  await expect(page.getByTestId('race-view')).toHaveCount(0)
  // No assistant reply was persisted (the race was discarded).
  await expect(page.getByTestId('transcript')).not.toContainText('Hello from the fake provider')
})
