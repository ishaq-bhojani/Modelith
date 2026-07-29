import { _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function launchApp(extraEnv: Record<string, string> = {}): Promise<ElectronApplication> {
  return electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      OPEN_CODER_USER_DATA: mkdtempSync(join(tmpdir(), 'oc-e2e-')),
      ...extraEnv,
    },
  })
}
