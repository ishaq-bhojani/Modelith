import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch.js'

let app: ElectronApplication
let root: string

test.beforeAll(async () => {
  // A workspace fixture on disk; the env seam makes the picker resolve to it.
  root = mkdtempSync(join(tmpdir(), 'oc-ws-e2e-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'hello.ts'), 'export const hi = 1')
  app = await launchApp({ MODELITH_WORKSPACE_ROOT: root })
})
test.afterAll(async () => { await app.close() })

test('open a folder, browse its tree, add a file to the composer', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('new-session').click()

  await page.getByTestId('open-workspace').click()
  await expect(page.getByTestId('workspace-panel')).toBeVisible()

  // No folder is remembered yet in this fresh user-data dir → open via the seam.
  const openBtn = page.getByTestId('workspace-open')
  if (await openBtn.isVisible().catch(() => false)) await openBtn.click()

  const addBtn = page.getByTestId('tree-add').first()
  await expect(addBtn).toBeVisible({ timeout: 8000 })
  await addBtn.click()

  // The file's content lands in the composer as a fenced code block.
  await expect(page.getByTestId('composer-input')).toHaveValue(/hello\.ts/, { timeout: 8000 })
  await expect(page.getByTestId('composer-input')).toHaveValue(/export const hi = 1/)
})

test('a traversal read outside the root is rejected', async () => {
  const page = await app.firstWindow()
  // Drive the bridge directly: a ../ path must be refused by main's confinement.
  const rejected = await page.evaluate(async () => {
    try {
      await window.modelith.workspace.read('../../etc/passwd')
      return false
    } catch {
      return true
    }
  })
  expect(rejected).toBe(true)
})
