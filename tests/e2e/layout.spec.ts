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
  const sidebar = page.getByTestId('sidebar')
  const handle = page.getByTestId('splitter')

  // A boundingBox() read alone proves the element is laid out, not that
  // React has finished attaching its pointer handlers. Waiting for both to
  // report visible, then hovering the handle before pressing, establishes
  // the pointer on the element and closes the race where mouse.down() fires
  // before the splitter's listener is live.
  await expect(sidebar).toBeVisible()
  await expect(handle).toBeVisible()
  await handle.hover()

  const before = await sidebar.boundingBox()
  const box = await handle.boundingBox()
  if (!box || !before) throw new Error('missing layout boxes')

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()

  // Poll rather than sample once: a drag that lands a frame or two late
  // should pass honestly instead of racing a single readback.
  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
    .toBeGreaterThan(before.width + 40)
})
