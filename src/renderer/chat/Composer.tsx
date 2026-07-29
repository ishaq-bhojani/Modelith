import { useState } from 'react'
import { useAppStore } from '../state/store.js'

export function Composer(): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const streamId = useAppStore((s) => s.streamId)
  const streamingSessionId = useAppStore((s) => s.streamingSessionId)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const send = useAppStore((s) => s.send)
  const stop = useAppStore((s) => s.stop)

  // `stop()` aborts whichever stream is globally tracked by `streamId`,
  // regardless of which session the user is viewing. Showing Stop here must
  // therefore be gated on the running stream actually belonging to the
  // session on screen — otherwise clicking Stop while viewing session B
  // would abort session A's in-flight turn.
  const streamingHere = streamId !== null && streamingSessionId === activeSessionId

  const submit = () => {
    const text = draft.trim()
    if (!text || streamingHere) return
    setDraft('')
    void send(text)
  }

  return (
    <div className="composer">
      <textarea
        data-testid="composer-input"
        value={draft}
        rows={3}
        placeholder="Ask anything"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
        }}
      />
      {streamingHere
        ? <button data-testid="composer-stop" onClick={() => void stop()}>Stop</button>
        : <button data-testid="composer-send" onClick={submit}>Send</button>}
    </div>
  )
}
