import { useLayoutEffect, useRef } from 'react'
import { useAppStore } from '../state/store.js'
import { ModeMenu } from './ModeMenu.js'
import { IconArrowUp, IconGauge, IconPaperclip, IconStop } from '../app/icons.js'

/** Same ~4 chars/token heuristic main uses for context budgeting. */
function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.max(1, Math.ceil(text.length / 4))
}

// Attachments are text/code only in v0 (no content-model change). A generous
// ceiling keeps a stray binary or huge file from bloating the prompt.
const MAX_ATTACH_BYTES = 256 * 1024

function fenceLang(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', py: 'python', rs: 'rust', go: 'go',
    java: 'java', rb: 'ruby', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', sh: 'bash',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', md: 'markdown', html: 'html',
    css: 'css', sql: 'sql', xml: 'xml',
  }
  return map[ext] ?? ''
}

export function Composer(): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const draft = useAppStore((s) => s.draft)
  const setDraft = useAppStore((s) => s.setDraft)
  const canvasSelection = useAppStore((s) => s.canvasSelection)
  const setCanvasSelection = useAppStore((s) => s.setCanvasSelection)
  const requestSend = useAppStore((s) => s.requestSend)
  const streamId = useAppStore((s) => s.streamId)
  const streamingSessionId = useAppStore((s) => s.streamingSessionId)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const stop = useAppStore((s) => s.stop)
  const toggleInspector = useAppStore((s) => s.toggleInspector)
  const reportError = useAppStore((s) => s.reportError)

  // `stop()` aborts whichever stream is globally tracked by `streamId`,
  // regardless of which session the user is viewing. Showing Stop here must be
  // gated on the running stream belonging to the session on screen.
  const streamingHere = streamId !== null && streamingSessionId === activeSessionId

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  const onFiles = async (files: FileList | null) => {
    if (!files) return
    const blocks: string[] = []
    for (const file of Array.from(files)) {
      if (file.size > MAX_ATTACH_BYTES) {
        reportError(new Error(`${file.name} is too large to attach (max 256 KB of text).`))
        continue
      }
      try {
        const text = await file.text()
        blocks.push(`${file.name}:\n\n\`\`\`${fenceLang(file.name)}\n${text}\n\`\`\``)
      } catch {
        reportError(new Error(`${file.name} could not be read as text.`))
      }
    }
    if (blocks.length > 0) {
      const prefix = draft.trim() ? `${draft.trimEnd()}\n\n` : ''
      setDraft(`${prefix}${blocks.join('\n\n')}\n\n`)
      textareaRef.current?.focus()
    }
  }

  // A one-line preview of the selected element for the refine chip.
  const selectionLabel = canvasSelection
    ? canvasSelection.replace(/\s+/g, ' ').trim().slice(0, 60)
    : ''

  return (
    <div className="composer-dock">
      <div className="composer-column">
        {canvasSelection ? (
          <div className="selection-chip" data-testid="selection-chip">
            <span className="selection-chip-label" title={canvasSelection}>
              Refining: <code>{selectionLabel}</code>
            </span>
            <button
              className="selection-chip-dismiss"
              data-testid="selection-chip-dismiss"
              aria-label="Clear selection"
              onClick={() => setCanvasSelection(null)}
            >
              ×
            </button>
          </div>
        ) : null}
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
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); requestSend() }
            }}
          />
          <div className="composer-row">
            <ModeMenu />
            <button
              className="chip-button"
              data-testid="attach"
              title="Attach a text or code file"
              onClick={() => fileRef.current?.click()}
            >
              <IconPaperclip size={13} />
              Attach
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="visually-hidden"
              data-testid="attach-input"
              onChange={(e) => { void onFiles(e.target.files); e.target.value = '' }}
            />
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
            <span className="token-count">{draft ? `≈${estimateTokens(draft)} tokens` : ''}</span>
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
                onClick={requestSend}
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
