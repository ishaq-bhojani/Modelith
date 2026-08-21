import { test, expect } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch.js'

let app: ElectronApplication
const rootA = mkdtempSync(join(tmpdir(), 'oc-proj-a-'))
const rootB = mkdtempSync(join(tmpdir(), 'oc-proj-b-'))

// Distinct on-disk markers so the workspace tree can prove which root it is
// showing, and so the "nothing on disk is touched" assertion has something
// concrete to check for after a project is removed.
writeFileSync(join(rootA, 'a-marker.txt'), 'a')
writeFileSync(join(rootB, 'b-marker.txt'), 'b')

test.beforeAll(async () => { app = await launchApp({ MODELITH_WORKSPACE_ROOT: rootA }) })
test.afterAll(async () => { await app.close() })

// `Workspace.pick()` (src/main/workspace/service.ts) reads
// MODELITH_WORKSPACE_ROOT fresh on every call — that is the seam that lets
// the native folder dialog be skipped in tests. Repointing it mid-run via
// `app.evaluate` (already used elsewhere, e.g. security.spec.ts) is how a
// single running app instance is made to open a SECOND, distinct project:
// the picker always resolves to whatever the env var currently holds.
async function setNextPickedFolder(root: string): Promise<void> {
  await app.evaluate(({}, r) => { process.env['MODELITH_WORKSPACE_ROOT'] = r }, root)
}

async function activateProject(page: Page, needle: RegExp): Promise<void> {
  await page.getByTestId('project-row').filter({ hasText: needle }).click()
}

function projectGroup(page: Page, needle: RegExp): Locator {
  return page.getByTestId('project-group').filter({
    has: page.getByTestId('project-row').filter({ hasText: needle }),
  })
}

// Scoped to a `.session-row` inside `scope` (a project-group, unfiled-group,
// or the page itself) whose title is EXACTLY `title` — never a substring.
// `.session-row`'s own text also contains "N ago"/"just now"; and every
// row's "move to project" <select> lists every project's name, so matching
// on the row's whole text (or the group's) can false-match through an
// unrelated project or a same-prefixed title. Anchor on the title span.
function sessionRow(page: Page, scope: Locator, title: string): Locator {
  return scope.locator('.session-row').filter({ has: page.getByText(title, { exact: true }) })
}

async function renameSession(page: Page, from: string, to: string): Promise<void> {
  const row = page.locator('.session-row').filter({ has: page.getByText(from, { exact: true }) })
  await row.hover() // row-actions are `display: none` until :hover/:focus-within (theme.css)
  await row.getByRole('button', { name: `Rename ${from}` }).click()
  const input = page.getByTestId('rename-input')
  await input.fill(to)
  await input.press('Enter')
}

async function moveToUnfiled(page: Page, title: string): Promise<void> {
  const row = page.locator('.session-row').filter({ has: page.getByText(title, { exact: true }) })
  await row.hover()
  await row.getByTestId('move-session').selectOption('')
}

async function removeProjectByFolder(page: Page, needle: RegExp): Promise<void> {
  const row = page.getByTestId('project-row').filter({ hasText: needle })
  await row.hover()
  page.once('dialog', (d) => void d.accept())
  await row.getByTestId('project-remove').click()
}

test('adding a folder creates a project and makes it active', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('project-add').click()
  const row = page.getByTestId('project-row').first()
  await expect(row).toBeVisible()
  await expect(row).toHaveAttribute('aria-current', 'true')
})

test('a new chat lands in the active project', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('new-session').click()
  await expect(page.getByTestId('project-group').first()).toContainText('New chat')
  // Give it a stable, unique title so later assertions can target this exact
  // session instead of relying on every default "New chat" title staying
  // distinguishable once more chats exist.
  await renameSession(page, 'New chat', 'session-in-A')
})

test('two projects: a session created while A is active groups under A, not B', async () => {
  const page = await app.firstWindow()

  await setNextPickedFolder(rootB)
  await page.getByTestId('project-add').click()
  const rowB = page.getByTestId('project-row').filter({ hasText: /oc-proj-b-/ })
  await expect(rowB).toHaveAttribute('aria-current', 'true')

  await page.getByTestId('new-session').click()
  await renameSession(page, 'New chat', 'session-in-B')

  const groupA = projectGroup(page, /oc-proj-a-/)
  const groupB = projectGroup(page, /oc-proj-b-/)

  await expect(sessionRow(page, groupA, 'session-in-A')).toBeVisible()
  await expect(sessionRow(page, groupB, 'session-in-B')).toBeVisible()
  // The negative checks are the point of this test: a session made while B
  // is active must not also show up under A, and vice versa.
  await expect(sessionRow(page, groupA, 'session-in-B')).toHaveCount(0)
  await expect(sessionRow(page, groupB, 'session-in-A')).toHaveCount(0)
})

test('switching the active project re-points the workspace tree without re-picking a folder', async () => {
  const page = await app.firstWindow()
  const tree = page.getByTestId('workspace-tree')

  // Only project-row clicks below — no workspace-open/workspace-change, i.e.
  // no re-pick of a folder.
  await activateProject(page, /oc-proj-a-/)
  await expect(tree).toContainText('a-marker.txt')
  await expect(tree).not.toContainText('b-marker.txt')

  await activateProject(page, /oc-proj-b-/)
  await expect(tree).toContainText('b-marker.txt')
  await expect(tree).not.toContainText('a-marker.txt')
})

test('collapsing a project group unmounts its sessions rather than hiding them', async () => {
  const page = await app.firstWindow()
  const groupA = projectGroup(page, /oc-proj-a-/)
  const collapseBtn = groupA.getByTestId('project-collapse')

  await expect(sessionRow(page, groupA, 'session-in-A')).toBeVisible()
  await expect(collapseBtn).toHaveAttribute('aria-expanded', 'true')

  await collapseBtn.click()
  await expect(collapseBtn).toHaveAttribute('aria-expanded', 'false')
  // toHaveCount(0), not toBeHidden(): the row must be gone from the DOM
  // entirely, not merely CSS-hidden while still present.
  await expect(sessionRow(page, groupA, 'session-in-A')).toHaveCount(0)

  await collapseBtn.click()
  await expect(collapseBtn).toHaveAttribute('aria-expanded', 'true')
  await expect(sessionRow(page, groupA, 'session-in-A')).toBeVisible()
})

test('a session with no projectId appears under Unfiled, which renders only when non-empty', async () => {
  const page = await app.firstWindow()
  // Nothing has been unfiled yet at this point in the run.
  await expect(page.getByTestId('unfiled-group')).toHaveCount(0)

  await moveToUnfiled(page, 'session-in-B')

  const unfiled = page.getByTestId('unfiled-group')
  await expect(unfiled).toBeVisible()
  await expect(sessionRow(page, unfiled, 'session-in-B')).toBeVisible()
  await expect(sessionRow(page, projectGroup(page, /oc-proj-b-/), 'session-in-B')).toHaveCount(0)
})

test('removing a project leaves its sessions intact under Unfiled and removes the group; nothing on disk is touched', async () => {
  const page = await app.firstWindow()

  await activateProject(page, /oc-proj-a-/)
  await page.getByTestId('new-session').click()
  await renameSession(page, 'New chat', 'session-in-A2')
  await expect(sessionRow(page, projectGroup(page, /oc-proj-a-/), 'session-in-A2')).toBeVisible()

  await removeProjectByFolder(page, /oc-proj-a-/)

  // The group is gone, not just emptied.
  await expect(page.getByTestId('project-row').filter({ hasText: /oc-proj-a-/ })).toHaveCount(0)

  // Both of project A's sessions (the one from before this test and the one
  // just created) survive, now under Unfiled — this is the state a
  // non-destructive Remove deliberately creates, so it must be exercised
  // rather than assumed.
  const unfiled = page.getByTestId('unfiled-group')
  await expect(sessionRow(page, unfiled, 'session-in-A')).toBeVisible()
  await expect(sessionRow(page, unfiled, 'session-in-A2')).toBeVisible()

  // Removing a project forgets the folder; it must never touch the folder itself.
  expect(existsSync(rootA)).toBe(true)
  expect(existsSync(join(rootA, 'a-marker.txt'))).toBe(true)
})
