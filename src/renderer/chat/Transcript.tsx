import { useAppStore } from '../state/store.js'
import { MessageView } from './MessageView.js'
import { ErrorNotice } from './ErrorNotice.js'
import { RaceView } from './RaceView.js'
import { useAutoScroll } from './useAutoScroll.js'

export function Transcript(): React.JSX.Element {
  const messages = useAppStore((s) => s.messages)
  const streamingText = useAppStore((s) => s.streamingText)
  const streamingSessionId = useAppStore((s) => s.streamingSessionId)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const error = useAppStore((s) => s.error)
  const openSettings = useAppStore((s) => s.openSettings)
  const model = useAppStore((s) => s.model)
  const streamNotice = useAppStore((s) => s.streamNotice)

  // A stream keeps accumulating into `streamingText` even while the user is
  // viewing a different session (see store.ts). Only render the buffer here
  // when it actually belongs to the session on screen — otherwise a stream
  // owned by session B would leak into a view of session A.
  const showStreaming = streamingSessionId === activeSessionId && streamingText !== ''
  const ref = useAutoScroll(messages.length + streamingText.length)

  return (
    <div data-testid="transcript" className="transcript" ref={ref}>
      <div className="transcript-column">
        {messages.map((m) => <MessageView key={m.id} message={m} />)}

        {streamNotice && streamingSessionId === activeSessionId ? (
          <div className="stream-notice" role="status" data-testid="stream-notice">{streamNotice}</div>
        ) : null}

        {showStreaming ? (
          <MessageView
            streaming
            {...(model ? { modelLabel: model } : {})}
            message={{ id: 'streaming', role: 'assistant', content: streamingText, createdAt: 0 }}
          />
        ) : null}

        <RaceView />

        {error ? (
          <ErrorNotice
            error={error}
            onAction={(kind) => { if (kind === 'auth' || kind === 'no_model') openSettings() }}
          />
        ) : null}
      </div>
    </div>
  )
}
