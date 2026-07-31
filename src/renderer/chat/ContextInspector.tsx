import { useEffect, useState } from 'react'
import { useAppStore } from '../state/store.js'
import type { ContextPreview } from '@shared/types'

/**
 * Shows exactly what will be sent on the next turn (roadmap 23): which messages
 * are included, their token cost, and what the budget trimmed. Surfaces the
 * `omittedCount` main has always computed and never displayed — demystifying the
 * black box, which builds trust faster than most capability features.
 */
export function ContextInspector(): React.JSX.Element | null {
  const open = useAppStore((s) => s.inspectorOpen)
  const toggle = useAppStore((s) => s.toggleInspector)
  const sessionId = useAppStore((s) => s.activeSessionId)
  const [preview, setPreview] = useState<ContextPreview | null>(null)

  useEffect(() => {
    if (!open || !sessionId) { setPreview(null); return }
    let cancelled = false
    void window.modelith.chat.preview(sessionId)
      .then((p) => { if (!cancelled) setPreview(p) })
      .catch(() => { if (!cancelled) setPreview(null) })
    return () => { cancelled = true }
  }, [open, sessionId])

  if (!open) return null

  const pct = preview ? Math.min(100, Math.round((preview.includedTokens / preview.budget) * 100)) : 0

  return (
    <aside className="inspector" data-testid="context-inspector" aria-label="Context inspector">
      <div className="inspector-head">
        <span className="inspector-title">Context</span>
        <button className="icon-button" aria-label="Close inspector" onClick={toggle}>✕</button>
      </div>

      {!preview ? (
        <p className="inspector-empty">Nothing to send yet.</p>
      ) : (
        <>
          <div className="inspector-meter">
            <div className="inspector-meter-bar"><span style={{ width: `${pct}%` }} /></div>
            <div className="inspector-meter-label">
              {preview.includedTokens.toLocaleString()} / {preview.budget.toLocaleString()} tokens
              {preview.omittedCount > 0 ? ` · ${preview.omittedCount} trimmed` : ''}
            </div>
          </div>

          <div className="inspector-list">
            {preview.entries.length === 0 ? (
              <p className="inspector-empty">No messages yet.</p>
            ) : (
              preview.entries.map((e) => (
                <div key={e.id} className={`inspector-row${e.included ? '' : ' inspector-row-omitted'}`}>
                  <span className="inspector-role">{e.role}</span>
                  <span className="inspector-preview">{e.preview || '—'}</span>
                  <span className="inspector-tokens">{e.tokens}</span>
                </div>
              ))
            )}
          </div>
          {preview.omittedCount > 0 ? (
            <p className="inspector-note">
              The {preview.omittedCount} greyed message{preview.omittedCount === 1 ? '' : 's'} above the fold
              won’t be sent — the conversation exceeds the context budget, so the oldest exchanges are dropped.
            </p>
          ) : null}
        </>
      )}
    </aside>
  )
}
