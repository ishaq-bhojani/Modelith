import { useEffect } from 'react'

/**
 * Closes a modal on Escape while it is open. Registered on the capture phase so
 * it fires before element-level handlers, and only when `active` — so several
 * modals can each own this hook without fighting. Standard modal-dismissal UX
 * (paired with a backdrop click handler at the call site).
 */
export function useEscapeToClose(active: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, onClose])
}
