import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launchApp } from './launch.js'

let app: ElectronApplication

test.beforeAll(async () => { app = await launchApp() })
test.afterAll(async () => { await app.close() })

test('window.modelith.appInfo() resolves with a version and platform', async () => {
  const page = await app.firstWindow()
  const info = await page.evaluate(() => window.modelith.appInfo())
  expect(typeof info.version).toBe('string')
  expect(typeof info.platform).toBe('string')
})

test('window.modelith exposes no key-reading method', async () => {
  const page = await app.firstWindow()
  const keyMethodNames = await page.evaluate(() => Object.keys(window.modelith.keys))
  expect(keyMethodNames).toEqual(expect.arrayContaining(['set', 'delete', 'has']))
  expect(keyMethodNames).not.toContain('get')
  expect(keyMethodNames).not.toContain('read')
})

test('window.modelith.updates exposes only the intended methods', async () => {
  const page = await app.firstWindow()
  const names = await page.evaluate(() => Object.keys(window.modelith.updates))
  expect(names.sort()).toEqual(['check', 'getState', 'install', 'onStateChange', 'setEnabled'])
})

test('the updates bridge offers no way to redirect the update feed', async () => {
  const page = await app.firstWindow()
  const state = await page.evaluate(() => window.modelith.updates.getState())
  // The renderer can read state but never supplies owner/repo/URL: a
  // renderer-controlled feed would let compromised UI point the updater at an
  // attacker's binary.
  expect(state).not.toHaveProperty('feedUrl')
  expect(typeof state.currentVersion).toBe('string')
  expect(typeof state.canAutoInstall).toBe('boolean')
})

test('the projects bridge offers no way to supply a path', async () => {
  const page = await app.firstWindow()
  const names = await page.evaluate(() => Object.keys(window.modelith.projects))
  expect(names.sort()).toEqual(['create', 'list', 'openFolder', 'remove', 'rename', 'setActive'])
  // A renderer-supplied path would become an agent's confinement boundary.
  const created = await page.evaluate(() => window.modelith.projects.create.length)
  expect(created).toBe(0)
})

// Whole-branch review C1: the Workspace panel's Open/Change buttons used to go
// through `workspace.pick`, which creates-and-activates a project in main but
// returned only the root — leaving the renderer's project list and
// activeProjectId stale, with no sidebar group for the folder now on screen.
// Opening a folder now has exactly ONE entry point, `projects.create`, which
// returns the fresh { projects, activeId }. This keeps the second one from
// coming back.
test('the workspace bridge exposes no folder picker', async () => {
  const page = await app.firstWindow()
  const names = await page.evaluate(() => Object.keys(window.modelith.workspace))
  expect(names.sort()).toEqual(['current', 'read', 'revert', 'tree'])
})
