import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch.js'

let app: ElectronApplication
let root: string

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'oc-tg-'))
  writeFileSync(join(root, 'seed.txt'), 'seed')
  app = await launchApp({ OPEN_CODER_FAKE_PROVIDER: '1', OPEN_CODER_WORKSPACE_ROOT: root })
})
test.afterEach(async () => { await app.close() })

async function enableAgent(page: Awaited<ReturnType<ElectronApplication['firstWindow']>>) {
  await page.getByTestId('new-session').click()
  await page.getByTestId('open-workspace').click()
  const openBtn = page.getByTestId('workspace-open')
  if (await openBtn.isVisible().catch(() => false)) await openBtn.click()
  await expect(page.getByTestId('toggle-agent')).toBeEnabled({ timeout: 8000 })
  await page.getByTestId('toggle-agent').click()
  await page.getByTestId('open-workspace').click() // close the drawer
}

test('an approved command runs and its output returns', async () => {
  const page = await app.firstWindow()
  await enableAgent(page)
  await page.getByTestId('composer-input').fill('agent run it')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('tool-confirm')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('tool-confirm-args')).toContainText('echo oc-ran')
  await page.getByTestId('confirm-accept').click()
  await expect(page.getByTestId('transcript')).toContainText('oc-ran', { timeout: 10_000 })
})

test('a rejected command does not run', async () => {
  const page = await app.firstWindow()
  await enableAgent(page)
  await page.getByTestId('composer-input').fill('agent run it')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('tool-confirm')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('confirm-reject').click()
  await page.waitForTimeout(800)
  await expect(page.getByTestId('transcript')).not.toContainText('oc-ran')
})

test('an allowed prefix auto-runs matching commands without a gate', async () => {
  const page = await app.firstWindow()
  await enableAgent(page)
  await page.getByTestId('composer-input').fill('agent run one')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('tool-confirm')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('confirm-allow-prefix').click()
  await expect(page.getByTestId('transcript')).toContainText('oc-ran', { timeout: 10_000 })

  // A second identical command now runs without showing the gate.
  await page.getByTestId('composer-input').fill('agent run two')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('transcript')).toContainText('oc-ran', { timeout: 10_000 })
  await expect(page.getByTestId('tool-confirm')).toHaveCount(0)
})

test('the git panel shows the status of a repository', async () => {
  // Make the workspace a git repo with one untracked file.
  execFileSync('git', ['init'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 't@t.co'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: root })
  writeFileSync(join(root, 'tracked.txt'), 'hi')

  const page = await app.firstWindow()
  await page.getByTestId('new-session').click()
  // Open the workspace folder (sets the root main runs git in, and enables the
  // Git chip).
  await page.getByTestId('open-workspace').click()
  const openBtn = page.getByTestId('workspace-open')
  if (await openBtn.isVisible().catch(() => false)) await openBtn.click()
  await page.getByTestId('open-workspace').click() // close the drawer
  await expect(page.getByTestId('open-git')).toBeEnabled({ timeout: 8000 })
  await page.getByTestId('open-git').click()
  await expect(page.getByTestId('git-panel')).toBeVisible()
  await expect(page.getByTestId('git-panel')).toContainText('tracked.txt', { timeout: 8000 })
})
