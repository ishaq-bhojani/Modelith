import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launchApp } from './launch.js'

let app: ElectronApplication
test.beforeAll(async () => { app = await launchApp() })
test.afterAll(async () => { await app.close() })

test('renders the sidebar and composer', async () => {
  const page = await app.firstWindow()
  await expect(page.getByTestId('sidebar')).toBeVisible()
  await expect(page.getByTestId('composer-input')).toBeVisible()
})

test('the splitter moves the sidebar boundary', async () => {
  const page = await app.firstWindow()
  const before = await page.getByTestId('sidebar').boundingBox()
  const handle = page.getByTestId('splitter')
  const box = await handle.boundingBox()
  if (!box || !before) throw new Error('missing layout boxes')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  const after = await page.getByTestId('sidebar').boundingBox()
  expect(after?.width ?? 0).toBeGreaterThan(before.width + 40)
})
