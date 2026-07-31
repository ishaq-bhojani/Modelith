import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launchApp } from './launch.js'

let app: ElectronApplication
test.beforeAll(async () => { app = await launchApp({ MODELITH_FAKE_PROVIDER: '1' }) })
test.afterAll(async () => { await app.close() })

// A 1x1 transparent PNG.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

test('attach an image, see the thumbnail, and it reaches the provider', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('new-session').click()

  // Set the image on the attach input (bypasses the native file dialog).
  await page.getByTestId('attach-input').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_BASE64, 'base64'),
  })

  // A pending thumbnail appears above the composer.
  await expect(page.getByTestId('attachment-strip')).toBeVisible({ timeout: 5000 })

  await page.getByTestId('composer-input').fill('what is this?')
  await page.getByTestId('composer-send').click()

  // The fake provider echoes the attachment it received, proving the image
  // crossed IPC and was mapped into the provider request.
  await expect(page.getByTestId('transcript')).toContainText('GOT_IMAGE:1:image/png', { timeout: 10_000 })
  // And the sent image is shown under the user message.
  await expect(page.getByTestId('msg-attachments')).toBeVisible()
})

test('a staged attachment can be removed before sending', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('new-session').click()
  await page.getByTestId('attach-input').setInputFiles({
    name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from(PNG_BASE64, 'base64'),
  })
  await expect(page.getByTestId('attachment-strip')).toBeVisible({ timeout: 5000 })
  await page.getByTestId('attachment-remove').click()
  await expect(page.getByTestId('attachment-strip')).toHaveCount(0)
})
