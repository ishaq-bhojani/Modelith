import { useCallback, useEffect, useRef, useState } from 'react'
import type { HarnessToParent, ParentToHarness } from './harness.js'

interface UseHarness {
  ref: React.RefObject<HTMLIFrameElement | null>
  ready: boolean
  /** Wire to the iframe's onLoad — the reliable readiness signal (see below). */
  handleLoad(): void
  /** Send a render; queued until the harness is ready. */
  render(kind: 'html' | 'svg', content: string): void
  setSelectMode(enabled: boolean): void
}

/**
 * Parent side of the canvas ↔ harness channel. Manages the ready handshake,
 * validates that inbound messages come from THIS iframe (the opaque origin
 * makes `event.origin` worthless — `event.source` identity is the real check),
 * and queues renders until the harness is ready so nothing is dropped on mount.
 */
export function useHarness(onSelected: (outerHTML: string, path: string) => void): UseHarness {
  const ref = useRef<HTMLIFrameElement | null>(null)
  const [ready, setReady] = useState(false)
  const pending = useRef<ParentToHarness | null>(null)
  const onSelectedRef = useRef(onSelected)
  onSelectedRef.current = onSelected

  const post = useCallback((msg: ParentToHarness) => {
    ref.current?.contentWindow?.postMessage(msg, '*')
  }, [])

  const flush = useCallback(() => {
    setReady(true)
    if (pending.current) { post(pending.current); pending.current = null }
  }, [post])

  // The iframe's onLoad fires only after the harness document (its inline script
  // included) has executed — a reliable readiness signal. The harness's own
  // `ready` postMessage can race the parent's listener registration and be
  // missed, so onLoad is authoritative and the message is a backup.
  const handleLoad = useCallback(() => { flush() }, [flush])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Accept only messages from our own iframe's window.
      if (!ref.current || e.source !== ref.current.contentWindow) return
      const msg = e.data as HarnessToParent
      if (msg?.type === 'ready') {
        flush()
      } else if (msg?.type === 'selected') {
        onSelectedRef.current(msg.outerHTML, msg.path)
      }
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage) }
  }, [flush])

  const render = useCallback((kind: 'html' | 'svg', content: string) => {
    const msg: ParentToHarness = { type: 'render', kind, content }
    if (ready) post(msg)
    else pending.current = msg
  }, [ready, post])

  const setSelectMode = useCallback((enabled: boolean) => {
    post({ type: 'selectMode', enabled })
  }, [post])

  return { ref, ready, handleLoad, render, setSelectMode }
}
