import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../state/store.js'
import { deriveArtifacts, type Artifact } from './artifacts.js'
import { HARNESS_HTML } from './harness.js'
import { compileMermaid } from './mermaid.js'
import { useHarness } from './useHarness.js'
import { IconChevronDown } from '../app/icons.js'

/**
 * The live artifact canvas (artifact-canvas spec §7). Present only when the
 * viewed conversation has at least one artifact, so the app stays a clean chat
 * window until it needs to be more. Renders into a sandboxed, no-egress harness
 * iframe; mermaid is compiled to SVG before it crosses the boundary (Canvas 5).
 */
export function CanvasPane(): React.JSX.Element | null {
  const messages = useAppStore((s) => s.messages)
  const streamingText = useAppStore((s) => s.streamingText)
  const streamingSessionId = useAppStore((s) => s.streamingSessionId)
  const activeSessionId = useAppStore((s) => s.activeSessionId)

  const streamHere = streamingSessionId === activeSessionId ? streamingText : ''
  const artifacts = useMemo(
    () => deriveArtifacts(messages, streamHere),
    [messages, streamHere],
  )

  const [activeLang, setActiveLang] = useState<string | null>(null)
  const [versionOverride, setVersionOverride] = useState<number | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [compiled, setCompiled] = useState<{ kind: 'html' | 'svg'; content: string } | null>(null)
  const [compileError, setCompileError] = useState<string | null>(null)

  const setSelection = useAppStore((s) => s.setCanvasSelection)
  const { ref, handleLoad, render, setSelectMode: sendSelectMode } = useHarness((outerHTML) => {
    setSelection(outerHTML)
    setSelectMode(false)
  })

  // Keep a valid active tab as artifacts come and go.
  const active: Artifact | undefined =
    artifacts.find((a) => a.lang === activeLang) ?? artifacts[0]
  useEffect(() => {
    if (active && active.lang !== activeLang) setActiveLang(active.lang)
  }, [active, activeLang])

  // A newly-arrived version snaps to newest unless the user has stepped back.
  const versionCount = active?.versions.length ?? 0
  const versionIndex = versionOverride ?? (versionCount > 0 ? versionCount - 1 : 0)
  useEffect(() => { setVersionOverride(null) }, [versionCount, activeLang])

  const source = active?.versions[versionIndex] ?? ''

  // Compile the current version to what the harness renders. HTML/SVG pass
  // through unchanged; mermaid is compiled to SVG here — on the trusted side,
  // never inside the harness (spec §2.2) — which is async, hence the effect.
  useEffect(() => {
    if (!active) { setCompiled(null); setCompileError(null); return }
    if (active.lang === 'html') { setCompiled({ kind: 'html', content: source }); setCompileError(null); return }
    if (active.lang === 'svg') { setCompiled({ kind: 'svg', content: source }); setCompileError(null); return }

    // Mermaid: debounce so a diagram half-written by the stream is not compiled
    // (and error-flashed) on every token; only compile once the source settles.
    let cancelled = false
    const handle = setTimeout(() => {
      void compileMermaid(source).then((result) => {
        if (cancelled) return
        if (result.ok) { setCompiled({ kind: 'svg', content: result.svg }); setCompileError(null) }
        else setCompileError(result.error) // keep the last good render visible
      })
    }, 200)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [active, source])

  // Throttle render dispatch so streaming does not thrash the frame (spec §6.6).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!compiled) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => render(compiled.kind, compiled.content), 120)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [compiled, render])

  useEffect(() => { sendSelectMode(selectMode) }, [selectMode, sendSelectMode])

  if (artifacts.length === 0 || !active) return null

  return (
    <section className="canvas" data-testid="canvas">
      <div className="canvas-toolbar">
        <div className="canvas-tabs">
          {artifacts.map((a) => (
            <button
              key={a.id}
              className={`canvas-tab${a.lang === active.lang ? ' canvas-tab-active' : ''}`}
              onClick={() => { setActiveLang(a.lang); setVersionOverride(null) }}
            >
              {a.lang}
            </button>
          ))}
        </div>
        <span className="canvas-spacer" />
        {versionCount > 1 ? (
          <div className="canvas-versions">
            <button
              className="icon-button"
              aria-label="Previous version"
              disabled={versionIndex === 0}
              onClick={() => setVersionOverride(Math.max(0, versionIndex - 1))}
            >
              <IconChevronDown size={13} />
            </button>
            <span className="canvas-version-label">v{versionIndex + 1} of {versionCount}</span>
            <button
              className="icon-button"
              aria-label="Next version"
              disabled={versionIndex >= versionCount - 1}
              onClick={() => setVersionOverride(Math.min(versionCount - 1, versionIndex + 1))}
            >
              <IconChevronDown size={13} />
            </button>
          </div>
        ) : null}
        <button
          className={`chip-button${selectMode ? ' chip-button-active' : ''}`}
          data-testid="canvas-select"
          aria-pressed={selectMode}
          onClick={() => setSelectMode((v) => !v)}
        >
          {selectMode ? 'Click an element…' : 'Select'}
        </button>
      </div>

      {compileError ? (
        <div className="canvas-error" role="alert" data-testid="canvas-error">
          <span className="canvas-error-title">Diagram error</span>
          <span className="canvas-error-detail">{compileError}</span>
        </div>
      ) : null}

      <iframe
        ref={ref}
        className="canvas-frame"
        data-testid="canvas-frame"
        title="Artifact preview"
        sandbox="allow-scripts allow-modals"
        srcDoc={HARNESS_HTML}
        onLoad={handleLoad}
      />
    </section>
  )
}
