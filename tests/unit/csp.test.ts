import { describe, it, expect } from 'vitest'
import { buildCsp } from '../../src/main/security/csp.js'

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
  it('forbids inline script in production', () => {
    // Scoped to script-src deliberately: style-src carries 'unsafe-inline' by
    // design, so asserting on the whole policy string would be a false alarm.
    const scriptSrc = buildCsp(false)
      .split('; ')
      .find((d) => d.startsWith('script-src'))
    expect(scriptSrc).toBe("script-src 'self'")
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
