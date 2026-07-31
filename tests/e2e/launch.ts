import { _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function launchApp(extraEnv: Record<string, string> = {}): Promise<ElectronApplication> {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      MODELITH_USER_DATA: mkdtempSync(join(tmpdir(), 'oc-e2e-')),
      ...extraEnv,
    },
  })
  // Wait for the main window to exist before handing the app back — without this,
  // a test's first `app.evaluate(() => BrowserWindow.getAllWindows()[0])` can race
  // main's `app.whenReady().then(createWindow)` and see no window yet.
  await app.firstWindow()
  return app
}
