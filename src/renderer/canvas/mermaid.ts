/**
 * Compiles a mermaid diagram to SVG **in the renderer**, before anything is
 * sent to the harness (artifact-canvas spec §2.2). The harness therefore only
 * ever renders inert html/svg and never loads or runs mermaid itself — the
 * diagram engine, a large dependency, stays on the trusted side of the boundary
 * and out of the no-egress sandbox.
 *
 * Mermaid is imported lazily so it is absent from the initial bundle and only
 * paid for the first time a conversation actually contains a diagram.
 */

let initialized = false
let mermaidMod: typeof import('mermaid').default | null = null
let initializedTheme: 'default' | 'dark' | null = null

/** The app's current theme, read from the root the renderer stamps in App.tsx. */
function appMermaidTheme(): 'default' | 'dark' {
  return document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'default'
}

async function getMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidMod) {
    mermaidMod = (await import('mermaid')).default
  }
  // Re-initialise when the app theme changed so the diagram matches light/dark
  // instead of always rendering light nodes on a dark canvas.
  const theme = appMermaidTheme()
  if (!initialized || initializedTheme !== theme) {
    mermaidMod.initialize({
      startOnLoad: false,
      // Strict sanitises diagram-authored labels/links before they reach SVG,
      // a defence-in-depth layer on top of the harness's own isolation.
      securityLevel: 'strict',
      theme,
    })
    initialized = true
    initializedTheme = theme
  }
  return mermaidMod
}

let counter = 0

export type MermaidResult = { ok: true; svg: string } | { ok: false; error: string }

/** Compile `source` to an SVG string, or return a human-readable error. */
export async function compileMermaid(source: string): Promise<MermaidResult> {
  const trimmed = source.trim()
  if (!trimmed) return { ok: false, error: 'Empty diagram' }
  const id = `oc-mmd-${counter++}`
  try {
    const mermaid = await getMermaid()
    const { svg } = await mermaid.render(id, trimmed)
    return { ok: true, svg }
  } catch (err) {
    // Mermaid can leave an orphaned measurement node behind on a parse failure.
    document.getElementById(id)?.remove()
    document.getElementById(`d${id}`)?.remove()
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}
