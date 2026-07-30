import { useState } from 'react'
import { useAppStore } from '../state/store.js'
import { fencedAttachment } from './fence-lang.js'
import { IconFolder } from '../app/icons.js'

/** basename of a path, tolerant of both separators. */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

function humanSize(bytes?: number): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Read-only workspace browser (spec §A.4). Point at a folder, tick files, and
 * add them to the composer as fenced code blocks — the same format the file
 * attach produces, so this is pure text and needs no content-model change.
 * Files are read only when explicitly added, and only through main's confined
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

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  if (!open) return null

  const files = tree.filter((e) => e.kind === 'file')

  const toggleFile = (relPath: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(relPath)) next.delete(relPath)
      else next.add(relPath)
      return next
    })
  }

  const addSelected = async () => {
    if (selected.size === 0) return
    setBusy(true)
    const blocks: string[] = []
    for (const relPath of selected) {
      try {
        const { text } = await window.openCoder.workspace.read(relPath)
        blocks.push(fencedAttachment(baseName(relPath), text))
      } catch (err) {
        reportError(err instanceof Error ? err : new Error(`${relPath} could not be read.`))
      }
    }
    if (blocks.length > 0) {
      const prefix = draft.trim() ? `${draft.trimEnd()}\n\n` : ''
      setDraft(`${prefix}${blocks.join('\n\n')}\n\n`)
    }
    setSelected(new Set())
    setBusy(false)
  }

  return (
    <aside className="workspace" data-testid="workspace-panel" aria-label="Workspace">
      <div className="inspector-head">
        <span className="inspector-title">Workspace</span>
        <button className="icon-button" aria-label="Close workspace" onClick={toggle}>✕</button>
      </div>

      {!root ? (
        <div className="workspace-empty">
          <p>No folder open.</p>
          <button className="chip-button" data-testid="workspace-open" onClick={() => void pick()}>
            <IconFolder size={13} /> Open folder…
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
            {files.length === 0 ? (
              <p className="inspector-empty">No files.</p>
            ) : (
              files.map((f) => (
                <label
                  key={f.relPath}
                  className={`workspace-row${f.readable ? '' : ' workspace-row-disabled'}`}
                  title={f.readable ? f.relPath : `${f.relPath} — too large to read`}
                >
                  <input
                    type="checkbox"
                    data-testid="workspace-file"
                    disabled={!f.readable}
                    checked={selected.has(f.relPath)}
                    onChange={() => toggleFile(f.relPath)}
                  />
                  <span className="workspace-row-path">{f.relPath}</span>
                  <span className="workspace-row-size">{humanSize(f.size)}</span>
                </label>
              ))
            )}
          </div>

          <div className="workspace-actions">
            <button
              className="send-button workspace-add"
              data-testid="workspace-add"
              disabled={selected.size === 0 || busy}
              onClick={() => void addSelected()}
            >
              {busy ? 'Adding…' : `Add ${selected.size || ''} file${selected.size === 1 ? '' : 's'} to context`}
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
