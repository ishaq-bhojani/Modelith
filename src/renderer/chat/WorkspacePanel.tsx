import { useAppStore } from '../state/store.js'
import { fencedAttachment } from './fence-lang.js'
import { IconFolder } from '../app/icons.js'
import { WorkspaceTree } from './WorkspaceTree.js'

/** basename of a path, tolerant of both separators. */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/**
 * Persistent project tree (spec §A.4). Point at a folder and browse its
 * (already-confined) tree; add a file to the composer with a per-file ＋,
 * producing the same fenced-block text the file attach flow already
 * produces, so this is pure text and needs no content-model change. Files
 * are read only when explicitly added, and only through main's confined
 * `workspace.read`.
 */
export function WorkspacePanel(): React.JSX.Element | null {
  const open = useAppStore((s) => s.workspaceOpen)
  const toggle = useAppStore((s) => s.toggleWorkspace)
  const root = useAppStore((s) => s.workspaceRoot)
  const tree = useAppStore((s) => s.workspaceTree)
  const pick = useAppStore((s) => s.pickWorkspace)
  const draft = useAppStore((s) => s.draft)
  const setDraft = useAppStore((s) => s.setDraft)
  const reportError = useAppStore((s) => s.reportError)

  if (!open) return null

  const addFile = async (relPath: string) => {
    try {
      const { text } = await window.modelith.workspace.read(relPath)
      const block = fencedAttachment(baseName(relPath), text)
      const prefix = draft.trim() ? `${draft.trimEnd()}\n\n` : ''
      setDraft(`${prefix}${block}\n\n`)
    } catch (err) {
      reportError(err instanceof Error ? err : new Error(`${relPath} could not be read.`))
    }
  }

  return (
    <aside className="workspace" data-testid="workspace-panel" aria-label="Workspace">
      <div className="inspector-head">
        <span className="inspector-title">Project</span>
        <button className="icon-button" aria-label="Close project" onClick={toggle}>✕</button>
      </div>

      {!root ? (
        <div className="workspace-empty">
          <p>No folder open.</p>
          <button className="action-primary" data-testid="workspace-open" onClick={() => void pick()}>
            <IconFolder size={13} /> Open Folder…
          </button>
        </div>
      ) : (
        <>
          <div className="workspace-root">
            <IconFolder size={13} />
            <span className="workspace-root-name" title={root}>{baseName(root)}</span>
            <button className="ghost-button" data-testid="workspace-change" onClick={() => void pick()}>Change</button>
          </div>
          <div className="workspace-list">
            <WorkspaceTree entries={tree} onAddFile={(p) => void addFile(p)} />
          </div>
        </>
      )}
    </aside>
  )
}
