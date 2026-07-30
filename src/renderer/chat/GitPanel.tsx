import { useAppStore } from '../state/store.js'

/**
 * View-only git state (terminal-git spec §2): branch, changed files, and a diff.
 * Commits happen through the model's gated `git_commit` tool, not here, so this
 * panel never mutates the repo.
 */
export function GitPanel(): React.JSX.Element | null {
  const open = useAppStore((s) => s.gitOpen)
  const toggle = useAppStore((s) => s.toggleGit)
  const status = useAppStore((s) => s.gitStatus)
  const diff = useAppStore((s) => s.gitDiff)
  const refresh = useAppStore((s) => s.refreshGit)
  const showDiff = useAppStore((s) => s.showGitDiff)

  if (!open) return null

  return (
    <aside className="workspace" data-testid="git-panel" aria-label="Git">
      <div className="inspector-head">
        <span className="inspector-title">Git{status?.branch ? ` · ${status.branch}` : ''}</span>
        <div>
          <button className="ghost-button" data-testid="git-refresh" onClick={() => void refresh()}>Refresh</button>
          <button className="icon-button" aria-label="Close git" onClick={toggle}>✕</button>
        </div>
      </div>

      {!status?.isRepo ? (
        <p className="inspector-empty">Not a git repository.</p>
      ) : (
        <>
          <div className="workspace-list">
            {status.files.length === 0 ? (
              <p className="inspector-empty">Working tree clean.</p>
            ) : (
              status.files.map((f) => (
                <button
                  key={f.path}
                  className="workspace-row git-row"
                  data-testid="git-file"
                  onClick={() => void showDiff(f.path)}
                  title={f.path}
                >
                  <span className={`git-badge${f.staged ? ' git-badge-staged' : ''}`}>{f.staged ? f.work : f.work}</span>
                  <span className="workspace-row-path">{f.path}</span>
                </button>
              ))
            )}
          </div>
          {diff ? <pre className="diff-view git-diff" data-testid="git-diff">{diff}</pre> : null}
        </>
      )}
    </aside>
  )
}
