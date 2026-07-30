import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { buildCsp } from '../../src/main/security/csp.js'
import { HARNESS_HTML, HARNESS_SCRIPT_HASH } from '../../src/renderer/canvas/harness.js'

/**
 * The renderer is loaded two different ways, and they need different policies.
 *
 * Production loads `index.html` over file://, where `onHeadersReceived` never
 * fires — that build is governed by the meta tag in the HTML, and it contains
 * no inline scripts.
 *
 * Development loads over http:// from Vite, which injects an inline
 * React Refresh preamble into <head>. A `script-src` without 'unsafe-inline'
 * blocks it, `@vitejs/plugin-react` then throws "can't detect preamble", and
 * React never mounts — a completely blank window.
 */
describe('buildCsp', () => {
  it('forbids arbitrary inline script in production', () => {
    // Scoped to script-src deliberately: style-src carries 'unsafe-inline' by
    // design, so asserting on the whole policy string would be a false alarm.
    // Production allow-lists exactly one inline script — the canvas harness
    // bootstrap, by hash — and never opens 'unsafe-inline'.
    const scriptSrc = buildCsp(false)
      .split('; ')
      .find((d) => d.startsWith('script-src'))
    expect(scriptSrc).not.toContain("'unsafe-inline'")
    expect(scriptSrc).toBe(`script-src 'self' '${HARNESS_SCRIPT_HASH}'`)
  })

  it('the allow-listed hash actually matches the harness bootstrap script', () => {
    // If the harness script is edited without recomputing the hash, its srcdoc
    // frame (which inherits this CSP) would silently refuse to run — breaking
    // every artifact. Recompute from source so that drift fails here instead.
    const script = /<script>([\s\S]*?)<\/script>/.exec(HARNESS_HTML)?.[1] ?? ''
    const digest = createHash('sha256').update(script, 'utf8').digest('base64')
    expect(`sha256-${digest}`).toBe(HARNESS_SCRIPT_HASH)
    expect(buildCsp(false)).toContain(HARNESS_SCRIPT_HASH)
  })

  it('allows inline script in development so the Vite preamble runs', () => {
    const csp = buildCsp(true)
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'))
    expect(scriptSrc).toContain("'unsafe-inline'")
  })

  it('allows the HMR websocket in development', () => {
    const connectSrc = buildCsp(true)
      .split('; ')
      .find((d) => d.startsWith('connect-src'))
    expect(connectSrc).toContain('ws:')
  })

  it('does not allow the HMR websocket in production', () => {
    const connectSrc = buildCsp(false)
      .split('; ')
      .find((d) => d.startsWith('connect-src'))
    expect(connectSrc).toBe("connect-src 'self'")
  })

  it('keeps the non-negotiable directives in both modes', () => {
    for (const csp of [buildCsp(true), buildCsp(false)]) {
      expect(csp).toContain("object-src 'none'")
      expect(csp).toContain("base-uri 'none'")
      expect(csp).toContain("form-action 'none'")
      expect(csp).toContain("default-src 'self'")
    }
  })

  it('production policy matches the meta tag shipped in index.html', async () => {
    const { readFile } = await import('node:fs/promises')
    const html = await readFile('src/renderer/index.html', 'utf8')
    const meta = /http-equiv="Content-Security-Policy"\s*\n?\s*content="([^"]+)"/.exec(html)
    expect(meta?.[1]).toBe(buildCsp(false))
  })
})
