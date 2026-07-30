import { useLayoutEffect, useRef, useState } from 'react'
import { useAppStore } from '../state/store.js'
import { ModeMenu } from './ModeMenu.js'
import { IconArrowUp, IconGauge, IconStop } from '../app/icons.js'

/** Same ~4 chars/token heuristic main uses for context budgeting. */
function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.max(1, Math.ceil(text.length / 4))
}

export function Composer(): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const streamId = useAppStore((s) => s.streamId)
  const streamingSessionId = useAppStore((s) => s.streamingSessionId)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const send = useAppStore((s) => s.send)
  const stop = useAppStore((s) => s.stop)
  const toggleInspector = useAppStore((s) => s.toggleInspector)

  // `stop()` aborts whichever stream is globally tracked by `streamId`,
  // regardless of which session the user is viewing. Showing Stop here must
  // therefore be gated on the running stream actually belonging to the
  // session on screen — otherwise clicking Stop while viewing session B
  // would abort session A's in-flight turn.
  const streamingHere = streamId !== null && streamingSessionId === activeSessionId

  // Grow with content up to the CSS max-height, then scroll.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  const submit = () => {
    const text = draft.trim()
    if (!text || streamingHere) return
    setDraft('')
    void send(text)
  }

  return (
    <div className="composer-dock">
      <div className="composer-column">
        <div className="composer">
          <textarea
            ref={textareaRef}
            data-testid="composer-input"
            value={draft}
            rows={1}
            placeholder="Ask anything"
            aria-label="Message"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
            }}
          />
          <div className="composer-row">
            <ModeMenu />
            <button
              className="chip-button"
              data-testid="inspect-context"
              title="Inspect context"
              onClick={toggleInspector}
            >
              <IconGauge size={13} />
              Context
            </button>
            <span className="composer-spacer" />
            <span className="token-count">
              {draft ? `≈${estimateTokens(draft)} tokens` : ''}
            </span>
            {streamingHere ? (
              <button
                className="send-button stop-button"
                data-testid="composer-stop"
                title="Stop"
                aria-label="Stop generating"
                onClick={() => void stop()}
              >
                <IconStop size={15} />
              </button>
            ) : (
              <button
                className="send-button"
                data-testid="composer-send"
                title="Send"
                aria-label="Send message"
                disabled={draft.trim() === ''}
                onClick={submit}
              >
                <IconArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
        <div className="composer-hints">
          <span>⏎ send</span>
          <span>⇧⏎ newline</span>
        </div>
      </div>
    </div>
  )
}
