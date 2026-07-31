import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../state/store.js'
import type { ChatMessage, StreamEnvelope } from '@shared/types'
import { MessageView } from './MessageView.js'
import { IconArrowUp } from '../app/icons.js'

/**
 * A side-thread drawer (roadmap 21): a throwaway aside that does NOT pollute the
 * main conversation's context. It owns everything about its own turn — an
 * ephemeral session, its own message state, and its own event subscription — so
 * the main store's heavily-reviewed streaming state machine is never touched.
 * Events for the main and side threads share one channel but are keyed by
 * session id, so each side ignores the other's.
 *
 * The ephemeral session is created archived (kept out of the sidebar) and
 * deleted on close; a crash could orphan one, where it would only ever appear
 * under "Show archived".
 */
export function SideThread(): React.JSX.Element | null {
  const open = useAppStore((s) => s.sideThreadOpen)
  const seed = useAppStore((s) => s.sideThreadSeed)
  const close = useAppStore((s) => s.closeSideThread)
  const providerId = useAppStore((s) => s.providerId)
  const model = useAppStore((s) => s.model)

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [draft, setDraft] = useState('')
  const sessionRef = useRef<string | null>(null)

  // Create the ephemeral session when the drawer opens; delete it when it
  // closes. sessionRef mirrors sessionId so the cleanup and the event filter
  // read the latest value without re-subscribing.
  useEffect(() => {
    if (!open) return
    let created: string | null = null
    let cancelled = false
    void (async () => {
      const { id } = await window.modelith.sessions.create('Side thread')
      if (cancelled) { void window.modelith.sessions.delete(id); return }
      created = id
      sessionRef.current = id
      setSessionId(id)
      void window.modelith.sessions.setArchived(id, true)
    })()
    return () => {
      cancelled = true
      const id = created ?? sessionRef.current
      if (id) void window.modelith.sessions.delete(id)
      sessionRef.current = null
      setSessionId(null)
      setMessages([])
      setStreamingText('')
      setStreaming(false)
      setDraft(seed ? `> ${seed.replace(/\n/g, '\n> ')}\n\n` : '')
    }
    // Recreate only on open/close transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Seed the composer with the quoted selection when opening.
  useEffect(() => {
    if (open) setDraft(seed ? `> ${seed.replace(/\n/g, '\n> ')}\n\n` : '')
  }, [open, seed])

  // Own event subscription, filtered to this side session so main-thread events
  // (which carry a different session id) are ignored.
  useEffect(() => {
    return window.modelith.chat.onEvent((env: StreamEnvelope) => {
      if (env.sessionId !== sessionRef.current) return
      const e = env.event
      if (e.type === 'text') setStreamingText((t) => t + e.delta)
      else if (e.type === 'done') {
        setStreaming(false)
        setStreamingText((t) => {
          if (t) setMessages((m) => [...m, { id: `s-${Date.now()}`, role: 'assistant', content: t, createdAt: Date.now() }])
          return ''
        })
      } else if (e.type === 'error') {
        setStreaming(false)
        setStreamingText('')
        setMessages((m) => [...m, { id: `se-${Date.now()}`, role: 'assistant', content: `⚠ ${e.error.message}`, createdAt: Date.now(), incomplete: true }])
      }
    })
  }, [])

  if (!open) return null

  const send = () => {
    const content = draft.trim()
    const id = sessionRef.current
    if (!content || !id || streaming || !model) return
    setDraft('')
    setMessages((m) => [...m, { id: `su-${Date.now()}`, role: 'user', content, createdAt: Date.now() }])
    setStreamingText('')
    setStreaming(true)
    void window.modelith.chat.send({ sessionId: id, providerId, model, content })
      .catch(() => setStreaming(false))
  }

  return (
    <aside className="sidethread" data-testid="side-thread" aria-label="Side thread">
      <div className="sidethread-head">
        <span className="sidethread-title">Side thread</span>
        <button className="icon-button" aria-label="Close side thread" onClick={close}>✕</button>
      </div>
      <p className="sidethread-note">A throwaway aside — nothing here touches the main chat.</p>

      <div className="sidethread-body">
        {messages.map((m) => <MessageView key={m.id} message={m} />)}
        {streaming && streamingText ? (
          <MessageView streaming message={{ id: 'side-stream', role: 'assistant', content: streamingText, createdAt: 0 }} />
        ) : null}
      </div>

      <div className="sidethread-composer">
        <textarea
          data-testid="side-thread-input"
          rows={3}
          value={draft}
          placeholder="Ask on the side…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        />
        <button className="send-button" aria-label="Send" disabled={!draft.trim() || streaming} onClick={send}>
          <IconArrowUp size={16} />
        </button>
      </div>
    </aside>
  )
}
