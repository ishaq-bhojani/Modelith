import { useEffect, useState } from 'react'
import { useAppStore } from '../state/store.js'
import { IconBrand, WinClose, WinMaximize, WinMinimize, WinRestore } from './icons.js'

/**
 * The frameless-window title bar (design "Windows 11 — frameless titlebar").
 *
 * - macOS: the native traffic lights are drawn by the OS at top-left
 *   (`titleBarStyle: hiddenInset`), so this renders only a 40px draggable strip
 *   that keeps content clear of them. No custom controls.
 * - Windows / Linux: a full custom bar — brand mark + wordmark on the left
 *   (draggable), and minimise / maximise / close controls on the right.
 *
 * The whole bar is a drag region (`-webkit-app-region: drag`); interactive
 * controls opt back out with `no-drag` so clicks register instead of moving the
 * window.
 */
export function TitleBar(): React.JSX.Element {
  const platform = useAppStore((s) => s.platform)
  const isMac = platform === 'darwin'
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (isMac) return
    void window.openCoder.window.isMaximized().then(setMaximized)
    return window.openCoder.window.onMaximizedChange(setMaximized)
  }, [isMac])

  if (isMac) {
    // Native traffic lights occupy the left; this strip just provides the drag
    // region and the 40px content inset the design shows.
    return <div className="titlebar titlebar-mac" data-testid="titlebar" />
  }

  return (
    <div className="titlebar titlebar-win" data-testid="titlebar">
      <div className="titlebar-brand">
        <span className="titlebar-logo">
          <IconBrand size={10} />
        </span>
        <span className="titlebar-name">Open Coder</span>
      </div>
      <div className="titlebar-controls">
        <button
          className="win-control"
          data-testid="win-minimize"
          title="Minimize"
          aria-label="Minimize"
          onClick={() => void window.openCoder.window.minimize()}
        >
          <WinMinimize />
        </button>
        <button
          className="win-control"
          data-testid="win-maximize"
          title={maximized ? 'Restore' : 'Maximize'}
          aria-label={maximized ? 'Restore' : 'Maximize'}
          onClick={() => void window.openCoder.window.maximizeToggle()}
        >
          {maximized ? <WinRestore /> : <WinMaximize />}
        </button>
        <button
          className="win-control win-close"
          data-testid="win-close"
          title="Close"
          aria-label="Close"
          onClick={() => void window.openCoder.window.close()}
        >
          <WinClose />
        </button>
      </div>
    </div>
  )
}
