import { useCallback, useMemo, useState } from 'react'
import { useAppStore } from '../state/store.js'
import { lineDiff } from './line-diff.js'
import { useEscapeToClose } from '../app/useEscapeToClose.js'

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
  const allowCommandPrefix = useAppStore((s) => s.allowCommandPrefix)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const diff = useMemo(
    () => (pending ? lineDiff(pending.previous, pending.proposed) : []),
    [pending],
  )

  // Escape / backdrop click declines the pending action (never silently
  // applies): leave the editor if editing, else reject the confirm/edit.
  const dismiss = useCallback(() => {
    if (editing) { setEditing(false); return }
    if (confirm) resolveConfirm('reject')
    else if (pending) resolveEdit('reject')
  }, [editing, confirm, pending, resolveConfirm, resolveEdit])
  useEscapeToClose(confirm !== null || pending !== null, dismiss)

  // A tool-call confirmation takes precedence when present.
  if (confirm) {
    const isCommand = confirm.name === 'run_command' || confirm.name === 'git_commit'
    let command = ''
    if (isCommand) { try { command = String((JSON.parse(confirm.argsJson) as { command?: string }).command ?? '') } catch { /* keep '' */ } }
    const prefix = command.trim().split(/\s+/)[0] ?? ''
    return (
      <div className="modal-scrim" data-testid="tool-confirm" onClick={dismiss}>
        <div className="diff-gate" onClick={(e) => e.stopPropagation()}>
          <div className="diff-gate-head">
            <span className="diff-gate-title">
              {isCommand ? 'Run command' : <>Run tool <code>{confirm.name}</code></>}?
            </span>
          </div>
          <pre className="diff-view" data-testid="tool-confirm-args">{isCommand ? command : confirm.argsJson}</pre>
          <div className="diff-gate-actions">
            <button className="action-primary" data-testid="confirm-accept" onClick={() => resolveConfirm('accept')}>Run</button>
            <button className="ghost-button" data-testid="confirm-reject" onClick={() => resolveConfirm('reject')}>Reject</button>
            {isCommand ? (
              prefix ? (
                <button className="ghost-button" data-testid="confirm-allow-prefix" onClick={() => allowCommandPrefix(prefix)}>
                  Always allow “{prefix} …”
                </button>
              ) : null
            ) : (
              <button className="ghost-button" data-testid="confirm-allow" onClick={() => resolveConfirm('accept', true)}>Always allow this tool</button>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (!pending) return null

  const startEdit = () => { setDraft(pending.proposed); setEditing(true) }

  return (
    <div className="modal-scrim" data-testid="diff-gate" onClick={dismiss}>
      <div className="diff-gate" onClick={(e) => e.stopPropagation()}>
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
              <button className="action-primary" data-testid="diff-save" onClick={() => { resolveEdit('edited', draft); setEditing(false) }}>
                Apply edited
              </button>
              <button className="ghost-button" onClick={() => setEditing(false)}>Back to diff</button>
            </>
          ) : (
            <>
              <button className="action-primary" data-testid="diff-accept" onClick={() => resolveEdit('accept')}>Accept</button>
              <button className="ghost-button" data-testid="diff-reject" onClick={() => resolveEdit('reject')}>Reject</button>
              <button className="ghost-button" data-testid="diff-edit" onClick={startEdit}>Edit…</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
