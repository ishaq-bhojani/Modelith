import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launchApp } from './launch.js'

let app: ElectronApplication
test.beforeAll(async () => { app = await launchApp({ OPEN_CODER_FAKE_PROVIDER: '1' }) })
test.afterAll(async () => { await app.close() })

async function makeArtifact(app: ElectronApplication, prompt = 'make a canvas page') {
  const page = await app.firstWindow()
  await page.getByTestId('new-session').click()
  await page.getByTestId('composer-input').fill(prompt)
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

test('an assistant artifact shows an "Open in canvas" card, code kept in transcript', async () => {
  const page = await makeArtifact(app, 'make a canvas page')
  const card = page.getByTestId('artifact-card').first()
  await expect(card).toBeVisible({ timeout: 10_000 })
  await expect(card).toContainText('Open HTML in canvas')
  // The card is additive — the fenced code is still shown in the transcript.
  await expect(page.getByTestId('transcript')).toContainText('Hello canvas')
  // Clicking it keeps the canvas up (focus is exercised with tabs in Canvas 7).
  await card.click()
  await expect(page.getByTestId('canvas-frame')).toBeVisible()
})

test('a mermaid diagram is compiled to SVG and rendered', async () => {
  const page = await makeArtifact(app, 'draw a mermaid diagram')
  const frame = page.frameLocator('[data-testid="canvas-frame"]')
  // Mermaid is compiled to SVG in the renderer, then rendered inertly here.
  // Generous timeout: mermaid is lazily imported and initialised on first use,
  // which can be slow under parallel-worker contention.
  await expect(frame.locator('svg')).toBeVisible({ timeout: 15_000 })
})

test('an invalid mermaid diagram surfaces an error, not a broken frame', async () => {
  const page = await makeArtifact(app, 'draw a badmermaid diagram')
  await expect(page.getByTestId('canvas-error')).toBeVisible({ timeout: 15_000 })
})

test('two artifact languages produce two tabs', async () => {
  const page = await makeArtifact(app, 'draw a multicanvas please')
  await expect(page.getByTestId('canvas-tab')).toHaveCount(2, { timeout: 10_000 })
})

test('a rewrite is a new version, steppable — not a second tab', async () => {
  const page = await makeArtifact(app, 'give me twoversions')
  // Wait for the settled end-state (both versions streamed) before counting, so
  // the assertion never races a stale canvas from a previous test's session.
  const label = page.getByTestId('canvas-version-label')
  await expect(label).toHaveText('v2 of 2', { timeout: 10_000 })
  // A second html block is v2 of the same artifact, not a new tab (spec §5).
  await expect(page.getByTestId('canvas-tab')).toHaveCount(1)
  await page.getByRole('button', { name: 'Previous version' }).click()
  await expect(label).toHaveText('v1 of 2')
})

test('Branch pins the current version as a new tab', async () => {
  const page = await makeArtifact(app, 'make a canvas page')
  const frame = page.frameLocator('[data-testid="canvas-frame"]')
  await expect(frame.locator('#t')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('canvas-tab')).toHaveCount(1)
  await page.getByTestId('canvas-branch').click()
  await expect(page.getByTestId('canvas-tab')).toHaveCount(2)
  await expect(page.getByTestId('canvas-tab').nth(1)).toHaveText('html#2')
})

test('point-and-refine: selecting an element populates a chip and is sent inline', async () => {
  const page = await makeArtifact(app, 'make a canvas page')
  const frame = page.frameLocator('[data-testid="canvas-frame"]')
  await expect(frame.locator('#t')).toBeVisible({ timeout: 5000 })

  await page.getByTestId('canvas-select').click()
  await frame.locator('#t').click()
  // The selected element becomes a dismissible chip above the composer.
  await expect(page.getByTestId('selection-chip')).toBeVisible({ timeout: 5000 })

  await page.getByTestId('composer-input').fill('make it green')
  await page.getByTestId('composer-send').click()

  // The transcript collapses the persisted <selected-element> block to a chip.
  await expect(page.getByTestId('msg-selection-chip')).toBeVisible({ timeout: 8000 })
  await expect(page.getByTestId('transcript')).toContainText('make it green')
})

test('the selection chip can be dismissed', async () => {
  const page = await makeArtifact(app, 'make a canvas page')
  const frame = page.frameLocator('[data-testid="canvas-frame"]')
  await expect(frame.locator('#t')).toBeVisible({ timeout: 5000 })
  await page.getByTestId('canvas-select').click()
  await frame.locator('#t').click()
  await expect(page.getByTestId('selection-chip')).toBeVisible({ timeout: 5000 })
  await page.getByTestId('selection-chip-dismiss').click()
  await expect(page.getByTestId('selection-chip')).toHaveCount(0)
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
