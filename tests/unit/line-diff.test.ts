import { describe, it, expect } from 'vitest'
import { lineDiff } from '../../src/renderer/chat/line-diff.js'

describe('lineDiff', () => {
  it('marks every line as added for a new file (previous null)', () => {
    expect(lineDiff(null, 'a\nb')).toEqual([
      { kind: 'add', text: 'a' },
      { kind: 'add', text: 'b' },
    ])
  })

  it('keeps unchanged lines as same', () => {
    expect(lineDiff('a\nb\nc', 'a\nb\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
      { kind: 'same', text: 'c' },
    ])
  })

  it('shows a replaced line as a delete followed by an add', () => {
    const d = lineDiff('a\nb\nc', 'a\nB\nc')
    expect(d).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'B' },
      { kind: 'same', text: 'c' },
    ])
  })

  it('shows a pure insertion', () => {
    const d = lineDiff('a\nc', 'a\nb\nc')
    expect(d).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'add', text: 'b' },
      { kind: 'same', text: 'c' },
    ])
  })
})
