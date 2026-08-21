import type { AppSettingsStore } from '../settings/store.js'
import type { ProjectStore } from './store.js'

/**
 * One-time: turn the pre-projects `workspaceRoot` setting into a project.
 *
 * It creates a project from a folder the user genuinely had open. It files no
 * sessions — the spec is explicit that guessing which old conversations
 * belonged to that folder is what the Unfiled group exists to avoid.
 *
 * Genuinely one-time: `settings.workspaceRoot` is CLEARED once the project
 * exists, because nothing else in the app writes or clears it any more (the
 * pre-projects `Workspace.pick()` writer is gone). Left in place, this would
 * run on every launch forever, and `ProjectStore.create()` on an existing root
 * bumps `lastOpenedAt` and sets `activeId` — so the legacy folder would hijack
 * the active project and sort to the top of the sidebar on every restart, and
 * a legacy project the user removed would reappear, active, on the next
 * launch, with no UI able to stop it.
 *
 * The clear deliberately does NOT gate on `projects.json` existing: removing
 * the only project leaves that file present but empty, which is exactly the
 * resurrection case such a gate would miss.
 *
 * It is also ordered after `create()` and inside the same `try`, so a failed
 * migration leaves `workspaceRoot` in place and the next launch retries.
 * Idempotent regardless: `ProjectStore.create` reuses a project with the same
 * root, so even a re-run cannot produce duplicates.
 *
 * Deliberately never rejects. This runs unguarded at startup in
 * `src/main/index.ts`, before every other IPC handler is registered
 * (`registerChatHandlers`, `registerWorkspaceHandlers`,
 * `registerProjectHandlers`, the window controls, the app menu, the
 * updater). A rejection here would abort that whole `async` callback and
 * leave the user with a window that looks alive but has no working IPC
 * surface at all — worse than skipping the migration.
 *
 * `ProjectStore.read()` throws by design on a corrupt `projects.json` (fail
 * loudly rather than silently show zero projects), and its atomic
 * temp-file+rename `write()` can hit EBUSY/EPERM from a Windows antivirus
 * lock. Both are plausible at this exact call site. Catching here does not
 * weaken "fail loudly": the store itself is untouched by this catch, so
 * `projects:list` still surfaces the same corruption to the renderer the
 * next time it is called, and a `create()` that never completed never
 * overwrote a `projects.json` it could not read — the user's project list is
 * preserved, not discarded. What the catch buys is that a migration failure
 * costs one skipped migration (retried on the next launch) instead of a dead
 * app.
 */
export async function migrateWorkspaceRoot(
  settings: AppSettingsStore,
  projects: ProjectStore,
): Promise<void> {
  try {
    const root = (await settings.get())['workspaceRoot']
    if (typeof root !== 'string' || root.length === 0) return
    await projects.create(root)
    // `set` merges a patch and JSON.stringify drops undefined values, so this
    // removes the key from settings.json rather than persisting a null.
    await settings.set({ workspaceRoot: undefined })
  } catch (err) {
    // No logger is wired into main at this point in startup; this is a plain
    // diagnostic for whoever investigates a report of "my projects vanished".
    console.error('[projects] migrateWorkspaceRoot failed; skipping this launch:', err)
  }
}
