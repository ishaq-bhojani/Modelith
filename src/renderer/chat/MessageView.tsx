import { memo, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { ChatMessage } from '@shared/types'
import { useAppStore } from '../state/store.js'
import { IconCheck, IconCopy, IconGitBranch, IconPencil } from '../app/icons.js'
import { formatCost } from './cost.js'

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

  if (message.role === 'user') {
    return (
      <div className="msg-user-group">
        <div className="msg-user">{message.content}</div>
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
