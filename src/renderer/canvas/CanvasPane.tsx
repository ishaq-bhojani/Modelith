import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../state/store.js'
import { deriveArtifacts, type ArtifactLang } from './artifacts.js'
import { HARNESS_HTML } from './harness.js'
import { compileMermaid } from './mermaid.js'
import { useHarness } from './useHarness.js'
import { IconChevronDown, IconGitBranch } from '../app/icons.js'

/** A pinned snapshot of one version, kept only in renderer state (spec §5). */
interface Branch { id: string; lang: ArtifactLang; content: string }

/** A tab in the canvas toolbar — a derived artifact or a pinned branch. */
interface Tab { key: string; label: string; lang: ArtifactLang; versions: string[]; pinned: boolean }

/**
 * The live artifact canvas (artifact-canvas spec §7). Present only when the
 * viewed conversation has at least one artifact, so the app stays a clean chat
 * window until it needs to be more. Renders into a sandboxed, no-egress harness
 * iframe; mermaid is compiled to SVG before it crosses the boundary (Canvas 5).
 *
 * Tabs are the derived artifacts (one per language) plus any "branches" — the
 * escape hatch of spec §5: pinning the current version under a new id (html#2)
 * so a user genuinely building a second page is not forced to fight the
 * one-artifact-per-language rule. Branches live only in renderer state; on
 * reload the conversation re-derives without them.
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

  const [branches, setBranches] = useState<Branch[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [versionOverride, setVersionOverride] = useState<number | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [compiled, setCompiled] = useState<{ kind: 'html' | 'svg'; content: string } | null>(null)
  const [compileError, setCompileError] = useState<string | null>(null)

  const setSelection = useAppStore((s) => s.setCanvasSelection)
  const { ref, handleLoad, render, setSelectMode: sendSelectMode } = useHarness((outerHTML) => {
    setSelection(outerHTML)
    setSelectMode(false)
  })

  // Branches belong to the conversation on screen; drop them when it changes.
  useEffect(() => { setBranches([]) }, [activeSessionId])

  const tabs: Tab[] = useMemo(() => [
    ...artifacts.map((a) => ({ key: a.id, label: a.lang, lang: a.lang, versions: a.versions, pinned: false })),
    ...branches.map((b) => ({ key: b.id, label: b.id, lang: b.lang, versions: [b.content], pinned: true })),
  ], [artifacts, branches])

  // Keep a valid active tab as tabs come and go.
  const active: Tab | undefined = tabs.find((t) => t.key === activeKey) ?? tabs[0]
  useEffect(() => {
    if (active && active.key !== activeKey) setActiveKey(active.key)
  }, [active, activeKey])

  // A transcript "Open in canvas" card focuses a language (its derived tab key
  // equals the language). The token changes on every click so re-clicking the
  // same card re-focuses even when the language is unchanged.
  const canvasFocus = useAppStore((s) => s.canvasFocus)
  useEffect(() => {
    if (canvasFocus && artifacts.some((a) => a.lang === canvasFocus.lang)) {
      setActiveKey(canvasFocus.lang)
      setVersionOverride(null)
    }
  }, [canvasFocus, artifacts])

  // A newly-arrived version snaps to newest unless the user has stepped back.
  const versionCount = active?.versions.length ?? 0
  const versionIndex = versionOverride ?? (versionCount > 0 ? versionCount - 1 : 0)
  useEffect(() => { setVersionOverride(null) }, [versionCount, activeKey])

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

  if (tabs.length === 0 || !active) return null

  const branchHere = () => {
    const n = branches.filter((b) => b.lang === active.lang).length + 2 // #1 is the derived tab
    const branch: Branch = { id: `${active.lang}#${n}`, lang: active.lang, content: source }
    setBranches((prev) => [...prev, branch])
    setActiveKey(branch.id)
    setVersionOverride(null)
  }

  return (
    <section className="canvas" data-testid="canvas">
      <div className="canvas-toolbar">
        <div className="canvas-tabs">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`canvas-tab${t.key === active.key ? ' canvas-tab-active' : ''}`}
              data-testid="canvas-tab"
              onClick={() => { setActiveKey(t.key); setVersionOverride(null) }}
            >
              {t.label}
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
            <span className="canvas-version-label" data-testid="canvas-version-label">v{versionIndex + 1} of {versionCount}</span>
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
          className="chip-button"
          data-testid="canvas-branch"
          title="Pin this version as a separate artifact"
          onClick={branchHere}
        >
          <IconGitBranch size={13} /> Branch
        </button>
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
