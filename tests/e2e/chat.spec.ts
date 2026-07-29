import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launchApp } from './launch.js'

let app: ElectronApplication
test.beforeAll(async () => { app = await launchApp({ OPEN_CODER_FAKE_PROVIDER: '1' }) })
test.afterAll(async () => { await app.close() })

test('streams a reply into the transcript', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('new-session').click()
  await page.getByTestId('composer-input').fill('hi there')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('transcript')).toContainText('hi there')
  await expect(page.getByTestId('transcript')).toContainText('Hello from the fake provider', { timeout: 10_000 })
})

test('stopping mid-stream marks the reply incomplete', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('new-session').click()
  await page.getByTestId('composer-input').fill('second turn')
  await page.getByTestId('composer-send').click()
  // Wait until at least the first word has actually streamed in, so Stop is
  // guaranteed to interrupt a genuinely partial reply rather than a race
  // against an empty buffer.
  await expect(page.getByTestId('transcript')).toContainText('Hello', { timeout: 5_000 })
  await page.getByTestId('composer-stop').click()
  await expect(page.getByTestId('composer-send')).toBeVisible()
  // The incomplete marker must reach a rendered message immediately — this is
  // the behavior the test name promises, not merely that the Stop button
  // reverted to Send.
  await expect(page.getByTestId('transcript')).toContainText('Stopped before completion.')
})
