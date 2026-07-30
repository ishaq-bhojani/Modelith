import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launchApp } from './launch.js'

let app: ElectronApplication
test.beforeAll(async () => { app = await launchApp({ OPEN_CODER_FAKE_PROVIDER: '1' }) })
test.afterAll(async () => { await app.close() })

async function makeArtifact(app: ElectronApplication) {
  const page = await app.firstWindow()
  await page.getByTestId('new-session').click()
  await page.getByTestId('composer-input').fill('make a canvas page')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('canvas')).toBeVisible({ timeout: 10_000 })
  return page
}

test('the canvas appears when the model emits an html artifact', async () => {
  const page = await makeArtifact(app)
  await expect(page.getByTestId('canvas-frame')).toBeVisible()
})

test('the canvas iframe is sandboxed and never same-origin', async () => {
  const page = await makeArtifact(app)
  const sandbox = await page.getByTestId('canvas-frame').getAttribute('sandbox')
  expect(sandbox).toContain('allow-scripts')
  // The one combination that would let the frame remove its own sandbox.
  expect(sandbox).not.toContain('allow-same-origin')
})

test('the harness renders the artifact content', async () => {
  const page = await makeArtifact(app)
  const frame = page.frameLocator('[data-testid="canvas-frame"]')
  await expect(frame.locator('#t')).toHaveText('Hello canvas', { timeout: 5000 })
})

test('code inside the harness cannot reach the network (no egress)', async () => {
  const page = await makeArtifact(app)
  const frames = page.frames()
  const harness = frames.find((f) => f.url().startsWith('about:') || f.url() === '')
    ?? frames[frames.length - 1]
  // §6.5 makes a security claim; prove it rather than assert it in a comment.
  const fetchFailed = await harness!.evaluate(async () => {
    try {
      await fetch('https://example.com')
      return false
    } catch {
      return true
    }
  })
  expect(fetchFailed).toBe(true)
})
