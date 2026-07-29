import { useRef } from 'react'
import { SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } from '../state/store.js'

interface Props {
  /** Current sidebar width in px — needed for `aria-valuenow` and to compute keyboard steps. */
  width: number
  onResize(clientX: number): void
}

const KEY_STEP = 16

/**
 * Pointer capture keeps every move event on this element even when the
 * pointer crosses another pane, so a drag cannot be lost mid-gesture.
 *
 * `role="separator"` on a resize handle carries an ARIA contract: it must be
 * focusable and operable from the keyboard (arrow keys to adjust, Home/End
 * for the extremes), with `aria-valuenow`/`aria-valuemin`/`aria-valuemax`
 * kept current — advertising the role without any of that would tell
 * assistive tech this control does something it can't actually do. `onResize`
 * already accepts a plain px value (it's called with `e.clientX` today, which
 * *is* the target width since the sidebar starts at x=0), so keyboard
 * handling only needs to compute that same kind of value and hand it off.
 */
export function Splitter({ width, onResize }: Props): React.JSX.Element {
  const dragging = useRef(false)

  return (
    <div
      data-testid="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-label="Resize sidebar"
      tabIndex={0}
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
      onKeyDown={(e) => {
        switch (e.key) {
          case 'ArrowLeft': onResize(width - KEY_STEP); break
          case 'ArrowRight': onResize(width + KEY_STEP); break
          case 'Home': onResize(SIDEBAR_MIN_WIDTH); break
          case 'End': onResize(SIDEBAR_MAX_WIDTH); break
          default: return
        }
        e.preventDefault()
      }}
    />
  )
}
