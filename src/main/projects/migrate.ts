import type { AppSettingsStore } from '../settings/store.js'
import type { ProjectStore } from './store.js'

/**
 * One-time: turn the pre-projects `workspaceRoot` setting into a project.
 *
 * It creates a project from a folder the user genuinely had open. It files no
 * sessions — the spec is explicit that guessing which old conversations
 * belonged to that folder is what the Unfiled group exists to avoid.
 *
 * Idempotent: `ProjectStore.create` reuses a project with the same root, so
 * running this on every launch cannot produce duplicates.
 */
export async function migrateWorkspaceRoot(
  settings: AppSettingsStore,
  projects: ProjectStore,
): Promise<void> {
  const root = (await settings.get())['workspaceRoot']
  if (typeof root !== 'string' || root.length === 0) return
  await projects.create(root)
}
