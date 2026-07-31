import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { launchApp } from './launch.js'

let app: ElectronApplication
let root: string

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'oc-pm-'))
  writeFileSync(join(root, 'seed.txt'), 'the seed marker lives here')
  app = await launchApp({ MODELITH_FAKE_PROVIDER: '1', MODELITH_WORKSPACE_ROOT: root })
})
test.afterEach(async () => { await app.close() })

async function openProject(page: Awaited<ReturnType<ElectronApplication['firstWindow']>>) {
  await page.getByTestId('new-session').click()
  await page.getByTestId('open-workspace').click()
  const openBtn = page.getByTestId('workspace-open')
  if (await openBtn.isVisible().catch(() => false)) await openBtn.click()
}

async function enableAgent(page: Awaited<ReturnType<ElectronApplication['firstWindow']>>) {
  await expect(page.getByTestId('toggle-agent')).toBeEnabled({ timeout: 8000 })
  await page.getByTestId('toggle-agent').click()
  await page.getByTestId('open-workspace').click() // close the drawer so the composer is clear
}

test('the project tree renders the folder contents', async () => {
  const page = await app.firstWindow()
  await openProject(page)
  await expect(page.getByTestId('workspace-tree')).toBeVisible({ timeout: 8000 })
  await expect(page.getByTestId('workspace-tree')).toContainText('seed.txt')
})

test('trust-this-turn applies multiple files from one approval', async () => {
  const page = await app.firstWindow()
  await openProject(page)
  await enableAgent(page)
  await page.getByTestId('composer-input').fill('agent multiwrite please')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('diff-gate')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('diff-accept-trust').click()
  // Both files land without a second gate.
  await expect.poll(() => existsSync(join(root, 'one.txt')), { timeout: 8000 }).toBe(true)
  await expect.poll(() => existsSync(join(root, 'two.txt')), { timeout: 8000 }).toBe(true)
  expect(readFileSync(join(root, 'two.txt'), 'utf8')).toBe('two\n')
  // One revert undoes the whole turn.
  await expect(page.getByTestId('revert-bar')).toBeVisible({ timeout: 8000 })
  await page.getByTestId('revert-edits').click()
  await expect.poll(() => existsSync(join(root, 'one.txt')), { timeout: 8000 }).toBe(false)
  await expect.poll(() => existsSync(join(root, 'two.txt')), { timeout: 8000 }).toBe(false)
})

test('search_files runs without a gate and the turn completes', async () => {
  const page = await app.firstWindow()
  await openProject(page)
  await enableAgent(page)
  await page.getByTestId('composer-input').fill('agent search the code')
  await page.getByTestId('composer-send').click()
  // No approval gate for a read-only search; the turn finishes cleanly.
  await expect(page.getByTestId('diff-gate')).toHaveCount(0)
  await expect(page.getByTestId('tool-confirm')).toHaveCount(0)
  await expect(page.getByTestId('transcript')).toContainText('seed.txt', { timeout: 10_000 })
})
