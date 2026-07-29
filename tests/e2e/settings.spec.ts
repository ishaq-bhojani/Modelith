import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launchApp } from './launch.js'

let app: ElectronApplication
test.beforeAll(async () => { app = await launchApp() })
test.afterAll(async () => { await app.close() })

test('stores a key and reports it as configured without revealing it', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('open-settings').click()
  await page.getByTestId('provider-select').selectOption('kimi')
  await page.getByTestId('api-key-input').fill('sk-test-value-123')
  await page.getByTestId('api-key-save').click()
  await expect(page.getByTestId('key-status')).toHaveText('Configured')
  await expect(page.getByTestId('api-key-input')).toHaveValue('')
})

test('offers a recovery action when the selected provider has no key', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('open-settings').click()
  // deepseek is deliberately a provider the previous test did not configure.
  await page.getByTestId('provider-select').selectOption('deepseek')
  await expect(page.getByTestId('key-status')).toHaveText('Not configured')
  await page.getByTestId('settings-close').click()
  await page.getByTestId('new-session').click()
  await page.getByTestId('composer-input').fill('hello')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('error-action')).toHaveText('Open settings')
})
