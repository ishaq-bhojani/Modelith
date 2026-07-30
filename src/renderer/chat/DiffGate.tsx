import { useMemo, useState } from 'react'
import { useAppStore } from '../state/store.js'
import { lineDiff } from './line-diff.js'

/**
 * The diff-approval gate (agentic-edits spec §4). When the agent proposes a
 * write, this shows the unified diff and blocks on the user's decision —
 * nothing is written until they Accept (optionally after hand-Editing) or
 * Reject. Rendered as a modal so the choice can't be missed mid-turn.
 */
export function DiffGate(): React.JSX.Element | null {
  const pending = useAppStore((s) => s.pendingEdit)
  const confirm = useAppStore((s) => s.pendingConfirm)
  const resolveEdit = useAppStore((s) => s.resolveEdit)
  const resolveConfirm = useAppStore((s) => s.resolveConfirm)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const diff = useMemo(
    () => (pending ? lineDiff(pending.previous, pending.proposed) : []),
    [pending],
  )

  // A generic (MCP) tool-call confirmation takes precedence when present.
  if (confirm) {
    return (
      <div className="modal-scrim" data-testid="tool-confirm">
        <div className="diff-gate">
          <div className="diff-gate-head">
            <span className="diff-gate-title">Run tool <code>{confirm.name}</code>?</span>
          </div>
          <pre className="diff-view" data-testid="tool-confirm-args">{confirm.argsJson}</pre>
          <div className="diff-gate-actions">
            <button className="send-button" data-testid="confirm-accept" onClick={() => resolveConfirm('accept')}>Run</button>
            <button className="ghost-button" data-testid="confirm-reject" onClick={() => resolveConfirm('reject')}>Reject</button>
            <button className="ghost-button" data-testid="confirm-allow" onClick={() => resolveConfirm('accept', true)}>Always allow this tool</button>
          </div>
        </div>
      </div>
    )
  }

  if (!pending) return null

  const startEdit = () => { setDraft(pending.proposed); setEditing(true) }

  return (
    <div className="modal-scrim" data-testid="diff-gate">
      <div className="diff-gate">
        <div className="diff-gate-head">
          <span className="diff-gate-title">
            {pending.previous === null ? 'Create' : 'Edit'} <code>{pending.relPath}</code>
          </span>
        </div>

        {editing ? (
          <textarea
            className="diff-gate-editor"
            data-testid="diff-gate-editor"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
          />
        ) : (
          <pre className="diff-view" data-testid="diff-view">
            {diff.map((line, i) => (
              <div key={i} className={`diff-line diff-${line.kind}`}>
                <span className="diff-gutter">{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}</span>
                <span className="diff-text">{line.text}</span>
              </div>
            ))}
          </pre>
        )}

        <div className="diff-gate-actions">
          {editing ? (
            <>
              <button className="send-button" data-testid="diff-save" onClick={() => { resolveEdit('edited', draft); setEditing(false) }}>
                Apply edited
              </button>
              <button className="ghost-button" onClick={() => setEditing(false)}>Back to diff</button>
            </>
          ) : (
            <>
              <button className="send-button" data-testid="diff-accept" onClick={() => resolveEdit('accept')}>Accept</button>
              <button className="ghost-button" data-testid="diff-reject" onClick={() => resolveEdit('reject')}>Reject</button>
              <button className="ghost-button" data-testid="diff-edit" onClick={startEdit}>Edit…</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
