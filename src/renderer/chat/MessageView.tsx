import { memo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { ChatMessage } from '@shared/types'

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

/** Memoized so a streaming append re-renders only the in-flight message. */
export const MessageView = memo(function MessageView({ message }: { message: ChatMessage }) {
  return (
    <article className={`msg msg-${message.role}`}>
      <div className="msg-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
      {message.incomplete ? <p className="msg-incomplete">Stopped before completion.</p> : null}
    </article>
  )
})
