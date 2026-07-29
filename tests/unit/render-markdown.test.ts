// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../../src/renderer/chat/MessageView.js'

describe('renderMarkdown', () => {
  it('keeps ordinary formatting', () => {
    expect(renderMarkdown('**bold** and `code`')).toContain('<strong>bold</strong>')
  })
  it('strips script tags', () => {
    expect(renderMarkdown('<script>alert(1)</script>hi')).not.toContain('<script')
  })
  it('strips inline event handlers', () => {
    expect(renderMarkdown('<img src=x onerror="alert(1)">')).not.toContain('onerror')
  })
  it('strips javascript: urls', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('javascript:')
  })
  it('strips style tags used for exfiltration', () => {
    expect(renderMarkdown('<style>body{background:url(http://evil)}</style>')).not.toContain('<style')
  })
})
