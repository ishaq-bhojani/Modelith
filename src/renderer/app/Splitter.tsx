import { useRef } from 'react'

interface Props { onResize(clientX: number): void }

/**
 * Pointer capture keeps every move event on this element even when the
 * pointer crosses another pane, so a drag cannot be lost mid-gesture.
 */
export function Splitter({ onResize }: Props): React.JSX.Element {
  const dragging = useRef(false)

  return (
    <div
      data-testid="splitter"
      role="separator"
      aria-orientation="vertical"
      className="splitter"
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        document.body.classList.add('resizing')
      }}
      onPointerMove={(e) => { if (dragging.current) onResize(e.clientX) }}
      onPointerUp={(e) => {
        dragging.current = false
        e.currentTarget.releasePointerCapture(e.pointerId)
        document.body.classList.remove('resizing')
      }}
    />
  )
}
