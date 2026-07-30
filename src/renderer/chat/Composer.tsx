import { useLayoutEffect, useRef } from 'react'
import { useAppStore } from '../state/store.js'
import { ModeMenu } from './ModeMenu.js'
import { fencedAttachment } from './fence-lang.js'
import { ALLOWED_IMAGE_MIME, validateAttachment } from '@shared/attachments'
import type { Attachment } from '@shared/types'
import { IconArrowUp, IconFolder, IconGauge, IconGitBranch, IconPaperclip, IconPanel, IconSliders, IconStop } from '../app/icons.js'

/** Read a File's bytes as bare base64 (no data: prefix) for an Attachment. */
async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

/** Same ~4 chars/token heuristic main uses for context budgeting. */
function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.max(1, Math.ceil(text.length / 4))
}

// Attachments are text/code only in v0 (no content-model change). A generous
// ceiling keeps a stray binary or huge file from bloating the prompt.
const MAX_ATTACH_BYTES = 256 * 1024

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
  const toggleWorkspace = useAppStore((s) => s.toggleWorkspace)
  const toggleMcp = useAppStore((s) => s.toggleMcp)
  const toggleGit = useAppStore((s) => s.toggleGit)
  const pendingAttachments = useAppStore((s) => s.pendingAttachments)
  const addAttachment = useAppStore((s) => s.addAttachment)
  const removeAttachment = useAppStore((s) => s.removeAttachment)
  const providerId = useAppStore((s) => s.providerId)
  const providers = useAppStore((s) => s.providers)
  const agentMode = useAppStore((s) => s.agentMode)
  const toggleAgentMode = useAppStore((s) => s.toggleAgentMode)
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const lastEditTurnId = useAppStore((s) => s.lastEditTurnId)
  const revertEdits = useAppStore((s) => s.revertEdits)
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

  const addImageFile = async (file: File) => {
    try {
      const attachment: Attachment = {
        type: 'image', mimeType: file.type, name: file.name, data: await fileToBase64(file),
      }
      const check = validateAttachment(attachment)
      if (!check.ok) { reportError(new Error(check.error)); return }
      addAttachment(attachment)
    } catch {
      reportError(new Error(`${file.name} could not be read.`))
    }
  }

  const onFiles = async (files: FileList | null) => {
    if (!files) return
    const blocks: string[] = []
    for (const file of Array.from(files)) {
      // Images become vision attachments; everything else is fenced as text.
      if (ALLOWED_IMAGE_MIME.has(file.type)) { await addImageFile(file); continue }
      if (file.size > MAX_ATTACH_BYTES) {
        reportError(new Error(`${file.name} is too large to attach (max 256 KB of text).`))
        continue
      }
      try {
        const text = await file.text()
        blocks.push(fencedAttachment(file.name, text))
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

  const onPaste = (e: React.ClipboardEvent) => {
    const images = Array.from(e.clipboardData.files).filter((f) => ALLOWED_IMAGE_MIME.has(f.type))
    if (images.length > 0) { e.preventDefault(); void Promise.all(images.map(addImageFile)) }
  }

  const visionProvider = providers.find((p) => p.id === providerId)?.vision ?? false
  const showVisionNote = pendingAttachments.length > 0 && !visionProvider

  // A one-line preview of the selected element for the refine chip.
  const selectionLabel = canvasSelection
    ? canvasSelection.replace(/\s+/g, ' ').trim().slice(0, 60)
    : ''

  return (
    <div className="composer-dock">
      <div className="composer-column">
        {lastEditTurnId ? (
          <div className="revert-bar" data-testid="revert-bar">
            <span>Edits applied to your files.</span>
            <button className="ghost-button" data-testid="revert-edits" onClick={() => void revertEdits(lastEditTurnId)}>
              Revert changes
            </button>
          </div>
        ) : null}
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
        {pendingAttachments.length > 0 ? (
          <div className="attachment-strip" data-testid="attachment-strip">
            {pendingAttachments.map((a, i) => (
              <div key={i} className="attachment-thumb" title={a.name}>
                <img src={`data:${a.mimeType};base64,${a.data}`} alt={a.name ?? 'attachment'} />
                <button
                  className="attachment-remove"
                  data-testid="attachment-remove"
                  aria-label="Remove attachment"
                  onClick={() => removeAttachment(i)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {showVisionNote ? (
          <div className="attachment-note" data-testid="vision-note">
            This model may not read images.
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
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); requestSend() }
            }}
          />
          <div className="composer-row">
            <ModeMenu />
            <button
              className="chip-button"
              data-testid="attach"
              title="Attach a text/code file or an image"
              onClick={() => fileRef.current?.click()}
            >
              <IconPaperclip size={13} />
              Attach
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/gif,image/webp,text/*,.ts,.tsx,.js,.jsx,.py,.rs,.go,.java,.rb,.c,.h,.cpp,.cs,.sh,.json,.yaml,.yml,.toml,.md,.html,.css,.sql,.xml"
              className="visually-hidden"
              data-testid="attach-input"
              onChange={(e) => { void onFiles(e.target.files); e.target.value = '' }}
            />
            <button
              className="chip-button"
              data-testid="open-workspace"
              title="Browse a workspace folder"
              onClick={toggleWorkspace}
            >
              <IconFolder size={13} />
              Files
            </button>
            <button
              className={`chip-button${agentMode ? ' chip-button-active' : ''}`}
              data-testid="toggle-agent"
              aria-pressed={agentMode}
              disabled={!workspaceRoot}
              title={workspaceRoot ? 'Let the model edit files (every change is approved)' : 'Open a workspace folder to enable agent edits'}
              onClick={toggleAgentMode}
            >
              <IconSliders size={13} />
              Agent
            </button>
            <button
              className="chip-button"
              data-testid="open-mcp"
              title="Manage MCP servers"
              onClick={toggleMcp}
            >
              <IconPanel size={13} />
              MCP
            </button>
            <button
              className="chip-button"
              data-testid="open-git"
              title="Git status"
              disabled={!workspaceRoot}
              onClick={toggleGit}
            >
              <IconGitBranch size={13} />
              Git
            </button>
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
