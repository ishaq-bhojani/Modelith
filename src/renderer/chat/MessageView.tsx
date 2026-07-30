import { memo, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { ChatMessage } from '@shared/types'
import { IconCheck, IconCopy } from '../app/icons.js'
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
  /**
   * Shown in the assistant meta row. Only passed for the in-flight reply,
   * where the selected model is genuinely the one producing it — persisted
   * messages carry no record of which model wrote them, so labelling them
   * with whatever is selected now would be a guess presented as a fact.
   */
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

/** Memoized so a streaming append re-renders only the in-flight message. */
export const MessageView = memo(function MessageView({
  message,
  modelLabel,
  streaming = false,
}: Props) {
  if (message.role === 'user') {
    return <div className="msg-user">{message.content}</div>
  }

  // Provenance for a persisted reply (model that wrote it, and its cost). The
  // streaming reply shows the currently-selected model via `modelLabel`
  // instead, since its provenance is not persisted until `done`.
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

      <div
        className="prose"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
      />
      {streaming ? <span className="caret" aria-hidden="true" /> : null}

      {message.incomplete ? <p className="msg-incomplete">Stopped before completion.</p> : null}

      {!streaming && message.content ? (
        <div className="msg-actions">
          <CopyButton text={message.content} />
        </div>
      ) : null}
    </article>
  )
})
