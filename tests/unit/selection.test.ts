import { describe, it, expect } from 'vitest'
import { encodeSelection, decodeSelection } from '../../src/renderer/canvas/selection.js'

describe('selection encoding', () => {
  it('wraps the element ahead of the prompt', () => {
    const out = encodeSelection('<button>Sign up</button>', 'make this green')
    expect(out).toBe('<selected-element>\n<button>Sign up</button>\n</selected-element>\n\nmake this green')
  })

  it('round-trips through decode', () => {
    const out = encodeSelection('<button class="cta">Sign up</button>', 'make it bigger')
    const { selection, body } = decodeSelection(out)
    expect(selection).toBe('<button class="cta">Sign up</button>')
    expect(body).toBe('make it bigger')
  })

  it('treats a message with no block as a plain prompt', () => {
    const { selection, body } = decodeSelection('just a normal message')
    expect(selection).toBeNull()
    expect(body).toBe('just a normal message')
  })

  it('does not mistake a mid-message mention for a block', () => {
    // The block is only recognised at the very start of the content.
    const content = 'talking about <selected-element> in prose'
    const { selection, body } = decodeSelection(content)
    expect(selection).toBeNull()
    expect(body).toBe(content)
  })

  it('is resilient to an unterminated block', () => {
    const { selection, body } = decodeSelection('<selected-element>\n<div>')
    expect(selection).toBeNull()
    expect(body).toBe('<selected-element>\n<div>')
  })

  it('trims surrounding whitespace from the element', () => {
    const { selection } = decodeSelection('<selected-element>\n  <p>hi</p>  \n</selected-element>\n\nx')
    expect(selection).toBe('<p>hi</p>')
  })
})
