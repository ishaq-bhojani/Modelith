import { describe, it, expect } from 'vitest'
import { unwrapIpcMessage } from '../../src/renderer/state/store.js'

describe('unwrapIpcMessage', () => {
  it('strips the Electron remote-method envelope', () => {
    expect(unwrapIpcMessage("Error invoking remote method 'chat:send': No API key is configured."))
      .toBe('No API key is configured.')
  })

  it('leaves a plain message unchanged', () => {
    expect(unwrapIpcMessage('Could not reach the provider.')).toBe('Could not reach the provider.')
  })

  it('handles a multi-line wrapped message', () => {
    expect(unwrapIpcMessage("Error invoking remote method 'x': line one\nline two"))
      .toBe('line one\nline two')
  })
})
