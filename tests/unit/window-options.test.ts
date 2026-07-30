import { describe, it, expect } from 'vitest'
import { WINDOW_OPTIONS } from '../../src/main/security/window-options.js'

describe('WINDOW_OPTIONS', () => {
  it('keeps the security invariants regardless of the frameless chrome', () => {
    // The chrome change must never weaken isolation — this is the property the
    // security E2E also guards, asserted here at the source.
    expect(WINDOW_OPTIONS.webPreferences?.contextIsolation).toBe(true)
    expect(WINDOW_OPTIONS.webPreferences?.nodeIntegration).toBe(false)
    expect(WINDOW_OPTIONS.webPreferences?.sandbox).toBe(true)
  })

  it('is frameless: either fully frameless or macOS hidden-inset', () => {
    // One of the two must hold, never a standard OS frame — otherwise the
    // renderer's title bar would sit below a duplicate OS one.
    if (process.platform === 'darwin') {
      expect(WINDOW_OPTIONS.titleBarStyle).toBe('hiddenInset')
    } else {
      expect(WINDOW_OPTIONS.frame).toBe(false)
    }
  })
})
