import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch.js'

let app: ElectronApplication
let root: string

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'oc-agent-'))
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'seed.txt'), 'seed') // ensure the root is non-empty
  app = await launchApp({ OPEN_CODER_FAKE_PROVIDER: '1', OPEN_CODER_WORKSPACE_ROOT: root })
})
test.afterEach(async () => { await app.close() })

async function startAgentTurn(prompt: string) {
  const page = await app.firstWindow()
  await page.getByTestId('new-session').click()
  await page.getByTestId('open-workspace').click()
  const openBtn = page.getByTestId('workspace-open')
  if (await openBtn.isVisible().catch(() => false)) await openBtn.click()
  // Enable agent mode (requires a workspace, now open).
  await expect(page.getByTestId('toggle-agent')).toBeEnabled({ timeout: 8000 })
  await page.getByTestId('toggle-agent').click()
  // Close the workspace drawer so it doesn't cover the composer's send button.
  await page.getByTestId('open-workspace').click()
  await expect(page.getByTestId('workspace-panel')).toHaveCount(0)
  await page.getByTestId('composer-input').fill(prompt)
  await page.getByTestId('composer-send').click()
  return page
}

test('an approved write is applied to the workspace', async () => {
  const page = await startAgentTurn('agent write the notes')
  await expect(page.getByTestId('diff-gate')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('diff-accept').click()
  // The file was written with exactly the proposed bytes.
  await expect.poll(() => existsSync(join(root, 'notes.txt')), { timeout: 8000 }).toBe(true)
  expect(readFileSync(join(root, 'notes.txt'), 'utf8')).toBe('hello from the agent\n')
})

test('a rejected write is not applied', async () => {
  const page = await startAgentTurn('agent write the notes')
  await expect(page.getByTestId('diff-gate')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('diff-reject').click()
  await expect(page.getByTestId('diff-gate')).toHaveCount(0)
  // Give the turn a moment to finish; nothing should have been written.
  await page.waitForTimeout(500)
  expect(existsSync(join(root, 'notes.txt'))).toBe(false)
})

test('a write outside the workspace root is refused (no gate, no file)', async () => {
  const page = await startAgentTurn('agent escape the sandbox')
  // The tool is refused in main before any gate — the turn simply completes
  // without a diff gate and without writing the sibling file.
  await page.waitForTimeout(1500)
  expect(existsSync(join(root, '..', 'escape.txt'))).toBe(false)
  await expect(page.getByTestId('diff-gate')).toHaveCount(0)
})

test('an applied change can be reverted', async () => {
  const page = await startAgentTurn('agent write the notes')
  await expect(page.getByTestId('diff-gate')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('diff-accept').click()
  await expect.poll(() => existsSync(join(root, 'notes.txt')), { timeout: 8000 }).toBe(true)
  await expect(page.getByTestId('revert-bar')).toBeVisible({ timeout: 8000 })
  await page.getByTestId('revert-edits').click()
  // The created file is removed by the revert (its pre-image did not exist).
  await expect.poll(() => existsSync(join(root, 'notes.txt')), { timeout: 8000 }).toBe(false)
})
