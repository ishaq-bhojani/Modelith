import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchApp } from './launch.js'

const FIXTURE = resolve('tests/fixtures/mcp-server.mjs')

let app: ElectronApplication
let root: string

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'oc-mcp-'))
  writeFileSync(join(root, 'seed.txt'), 'seed')
  app = await launchApp({ MODELITH_FAKE_PROVIDER: '1', MODELITH_WORKSPACE_ROOT: root })
})
test.afterEach(async () => { await app.close() })

async function addServerAndEnableAgent(page: Awaited<ReturnType<ElectronApplication['firstWindow']>>) {
  await page.getByTestId('new-session').click()
  // Add the fake stdio MCP server via the panel.
  await page.getByTestId('open-mcp').click()
  await page.getByTestId('mcp-name').fill('fake')
  await page.getByTestId('mcp-command').fill(process.execPath) // a real node binary
  await page.getByTestId('mcp-args').fill(FIXTURE)
  await page.getByTestId('mcp-add').click()
  // It connects and advertises its 'echo' tool.
  await expect(page.getByTestId('mcp-server')).toContainText('echo', { timeout: 10_000 })
  await page.getByTestId('open-mcp').click() // close the MCP drawer

  // Enable Agent mode (needs a workspace, provided via the env seam).
  await page.getByTestId('open-workspace').click()
  const openBtn = page.getByTestId('workspace-open')
  if (await openBtn.isVisible().catch(() => false)) await openBtn.click()
  await expect(page.getByTestId('toggle-agent')).toBeEnabled({ timeout: 8000 })
  await page.getByTestId('toggle-agent').click()
  await page.getByTestId('open-workspace').click() // close the workspace drawer
}

test('an MCP tool is called after approval and its result returns', async () => {
  const page = await app.firstWindow()
  await addServerAndEnableAgent(page)

  await page.getByTestId('composer-input').fill('agent mcp please')
  await page.getByTestId('composer-send').click()

  await expect(page.getByTestId('tool-confirm')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('confirm-accept').click()
  // The server's result (echo: hi) comes back into the conversation.
  await expect(page.getByTestId('transcript')).toContainText('echo: hi', { timeout: 10_000 })
})

test('a rejected MCP tool call does not run the server', async () => {
  const page = await app.firstWindow()
  await addServerAndEnableAgent(page)

  await page.getByTestId('composer-input').fill('agent mcp please')
  await page.getByTestId('composer-send').click()

  await expect(page.getByTestId('tool-confirm')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('confirm-reject').click()
  await expect(page.getByTestId('tool-confirm')).toHaveCount(0)
  await page.waitForTimeout(800)
  await expect(page.getByTestId('transcript')).not.toContainText('echo: hi')
})
