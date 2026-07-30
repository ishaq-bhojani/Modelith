import { describe, it, expect } from 'vitest'
import { applyEdit } from '../../src/main/workspace/edit-apply.js'

describe('applyEdit — search/replace', () => {
  const src = 'line one\nline two\nline three\n'

  it('replaces the unique occurrence of the search text', () => {
    const r = applyEdit(src, 'line two', 'line TWO')
    expect(r).toEqual({ ok: true, content: 'line one\nline TWO\nline three\n' })
  })

  it('replaces a multi-line search span', () => {
    const r = applyEdit(src, 'line one\nline two', 'X')
    expect(r).toEqual({ ok: true, content: 'X\nline three\n' })
  })

  it('errors when the search text is not present', () => {
    expect(applyEdit(src, 'nope', 'x')).toEqual({ ok: false, error: 'not-found' })
  })

  it('errors when the search text is ambiguous (multiple matches)', () => {
    // Two matches — a blind replace could hit the wrong one, so refuse.
    expect(applyEdit('a\na\n', 'a', 'b')).toEqual({ ok: false, error: 'ambiguous' })
  })

  it('rejects an empty search string', () => {
    expect(applyEdit(src, '', 'x')).toEqual({ ok: false, error: 'empty-search' })
  })

  it('allows deleting a span by replacing with empty', () => {
    expect(applyEdit(src, 'line two\n', '')).toEqual({ ok: true, content: 'line one\nline three\n' })
  })

  it('does not treat replacement text as a regex', () => {
    // $1 and backslashes must land literally, not as replacement patterns.
    const r = applyEdit('x = OLD', 'OLD', '$1 \\n')
    expect(r).toEqual({ ok: true, content: 'x = $1 \\n' })
  })
})
