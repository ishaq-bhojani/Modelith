import { memo, useMemo, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { ChatMessage } from '@shared/types'
import { useAppStore } from '../state/store.js'
import { CANVAS_LANGS, scanBlocks } from '../canvas/fence-scanner.js'
import { decodeSelection } from '../canvas/selection.js'
import { IconCheck, IconCopy, IconGitBranch, IconPanel, IconPencil } from '../app/icons.js'
import { formatCost } from './cost.js'

/**
 * The canvas-eligible languages a message contains, deduped and normalised
 * (mmd → mermaid), in first-seen order. Drives the "Open in canvas" cards.
 * Only complete blocks count, so a card never appears for a half-streamed one.
 */
/** Display label for an artifact language — HTML/SVG upper-cased, mermaid as-is. */
function labelForLang(lang: string): string {
  return lang === 'html' || lang === 'svg' ? lang.toUpperCase() : lang
}

function canvasLangsIn(source: string): string[] {
  const seen: string[] = []
  for (const b of scanBlocks(source)) {
    if (!b.complete || !CANVAS_LANGS.has(b.lang)) continue
    const lang = b.lang === 'mmd' ? 'mermaid' : b.lang
    if (!seen.includes(lang)) seen.push(lang)
  }
  return seen
}

/**
 * Model output is attacker-influenceable (prompt injection via pasted
 * content), so markdown HTML is sanitized before injection. The renderer's
 * CSP is a second layer, not the only one.
 */
export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(marked.parse(source, { async: false }), {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style', 'srcset', 'formaction'],
  })
}

interface Props {
  message: ChatMessage
  /** Shown in the assistant meta row for the in-flight reply (current model). */
  modelLabel?: string
  /** True while this message is still streaming; renders the caret. */
  streaming?: boolean
}

function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="ghost-button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        })
      }}
    >
      {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// An optimistic message not yet canonicalized from disk — edit/fork need real
// persisted ids, so their controls are withheld until the refresh lands.
const isLocalId = (id: string): boolean => id.startsWith('local-')

/** Memoized so a streaming append re-renders only the in-flight message. */
export const MessageView = memo(function MessageView({
  message,
  modelLabel,
  streaming = false,
}: Props) {
  const branchFrom = useAppStore((s) => s.branchFrom)
  const editUserMessage = useAppStore((s) => s.editUserMessage)
  const editAssistantMessage = useAppStore((s) => s.editAssistantMessage)
  const focusCanvas = useAppStore((s) => s.focusCanvas)

  const artifactLangs = useMemo(
    () => (message.role === 'assistant' ? canvasLangsIn(message.content) : []),
    [message.role, message.content],
  )

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const canAct = !streaming && !isLocalId(message.id)

  const startEdit = () => { setDraft(message.content); setEditing(true) }
  const commitEdit = () => {
    setEditing(false)
    const next = draft.trim()
    if (!next || next === message.content) return
    if (message.role === 'user') void editUserMessage(message.id, next)
    else void editAssistantMessage(message.id, next)
  }

  if (editing) {
    return (
      <div className={message.role === 'user' ? 'msg-user-edit' : 'msg-assistant'}>
        <textarea
          className="msg-edit-input"
          data-testid="msg-edit-input"
          autoFocus
          rows={Math.min(10, draft.split('\n').length + 1)}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitEdit() }
          }}
        />
        <div className="msg-actions">
          <button className="ghost-button" onClick={commitEdit}>
            {message.role === 'user' ? 'Save & resend' : 'Save'}
          </button>
          <button className="ghost-button" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    )
  }

  if (message.role === 'tool') {
    // A tool result is context, not conversation — render it as a quiet,
    // collapsed activity line rather than an assistant bubble.
    return (
      <div className="msg-tool" data-testid="msg-tool">
        <span className="msg-tool-label">tool result</span>
        <span className="msg-tool-body">{message.content.replace(/\s+/g, ' ').trim().slice(0, 300)}</span>
      </div>
    )
  }

  if (message.role === 'user') {
    // A point-and-refine message carries a <selected-element> block in its
    // persisted content; collapse it into a chip so the transcript shows what
    // was sent without the raw markup (spec §7).
    const { selection, body } = decodeSelection(message.content)
    return (
      <div className="msg-user-group">
        {selection ? (
          <div className="msg-selection-chip" data-testid="msg-selection-chip" title={selection}>
            <code>{selection.replace(/\s+/g, ' ').trim().slice(0, 80)}</code>
          </div>
        ) : null}
        {message.attachments && message.attachments.length > 0 ? (
          <div className="msg-attachments" data-testid="msg-attachments">
            {message.attachments.map((a, i) => (
              <img
                key={i}
                className="msg-attachment"
                src={`data:${a.mimeType};base64,${a.data}`}
                alt={a.name ?? 'attachment'}
              />
            ))}
          </div>
        ) : null}
        <div className="msg-user">{body}</div>
        {canAct ? (
          <div className="msg-actions msg-actions-user">
            <button className="ghost-button" data-testid="edit-message" onClick={startEdit}>
              <IconPencil size={12} /> Edit
            </button>
            <button className="ghost-button" data-testid="fork-message" onClick={() => void branchFrom(message.id)}>
              <IconGitBranch size={12} /> Fork
            </button>
          </div>
        ) : null}
      </div>
    )
  }

  const provenance = message.model ?? modelLabel
  const cost = formatCost(message.usage, message.provider, message.model)

  return (
    <article className="msg-assistant">
      {provenance ? (
        <div className="msg-meta">
          <span className="msg-model">{provenance}</span>
          {cost ? (
            <>
              <span className="msg-dot" />
              <span className="msg-stat" title="Estimated cost of this turn">{cost}</span>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
      {streaming ? <span className="caret" aria-hidden="true" /> : null}

      {/* Additive: the code stays in the transcript above; these just jump the
          canvas to it. Shown once streaming ends so the block is complete. */}
      {!streaming && artifactLangs.length > 0 ? (
        <div className="artifact-cards">
          {artifactLangs.map((lang) => (
            <button
              key={lang}
              className="artifact-card"
              data-testid="artifact-card"
              onClick={() => focusCanvas(lang)}
            >
              <IconPanel size={13} />
              <span>Open {labelForLang(lang)} in canvas</span>
            </button>
          ))}
        </div>
      ) : null}

      {message.incomplete ? <p className="msg-incomplete">Stopped before completion.</p> : null}

      {!streaming && message.content ? (
        <div className="msg-actions">
          <CopyButton text={message.content} />
          {canAct ? (
            <>
              <button className="ghost-button" data-testid="edit-message" onClick={startEdit}>
                <IconPencil size={12} /> Edit
              </button>
              <button className="ghost-button" data-testid="fork-message" onClick={() => void branchFrom(message.id)}>
                <IconGitBranch size={12} /> Fork
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  )
})
