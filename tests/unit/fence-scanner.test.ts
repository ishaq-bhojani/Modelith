import { describe, it, expect } from 'vitest'
import { scanBlocks } from '../../src/renderer/canvas/fence-scanner.js'

describe('scanBlocks', () => {
  it('finds a complete fenced block with its language', () => {
    const blocks = scanBlocks('before\n```html\n<h1>hi</h1>\n```\nafter')
    expect(blocks).toEqual([{ lang: 'html', content: '<h1>hi</h1>', complete: true }])
  })

  it('exposes an unterminated block as incomplete, with content so far', () => {
    const blocks = scanBlocks('```html\n<div>partial')
    expect(blocks).toEqual([{ lang: 'html', content: '<div>partial', complete: false }])
  })

  it('returns nothing when there is no fence', () => {
    expect(scanBlocks('just prose, no code')).toEqual([])
  })

  it('captures several blocks in order', () => {
    const blocks = scanBlocks('```html\n<a>\n```\ntext\n```svg\n<svg/>\n```')
    expect(blocks.map((b) => b.lang)).toEqual(['html', 'svg'])
    expect(blocks.map((b) => b.content)).toEqual(['<a>', '<svg/>'])
  })

  it('handles a fence with no language tag', () => {
    const blocks = scanBlocks('```\nplain\n```')
    expect(blocks).toEqual([{ lang: '', content: 'plain', complete: true }])
  })

  it('preserves blank lines and indentation inside a block', () => {
    const src = '```html\n<ul>\n\n  <li>x</li>\n</ul>\n```'
    expect(scanBlocks(src)[0]?.content).toBe('<ul>\n\n  <li>x</li>\n</ul>')
  })

  it('treats a tilde fence the same as a backtick fence', () => {
    expect(scanBlocks('~~~html\n<b/>\n~~~')).toEqual([{ lang: 'html', content: '<b/>', complete: true }])
  })

  it('does not close a backtick fence on a tilde line (fences must match)', () => {
    const blocks = scanBlocks('```html\n<b/>\n~~~\nstill inside')
    expect(blocks[0]).toEqual({ lang: 'html', content: '<b/>\n~~~\nstill inside', complete: false })
  })

  it('trims whitespace and lowercases the language tag', () => {
    expect(scanBlocks('```  HTML \n<b/>\n```')[0]?.lang).toBe('html')
  })

  it('produces identical blocks regardless of how the source is chunked', () => {
    // The stream arrives in arbitrary pieces; the scanner runs over the whole
    // accumulated text each token, so every prefix-to-full path must be stable.
    // This is the property that kept the SSE parser defect-free.
    const doc = 'intro\n```html\n<h1>title</h1>\n<p>body</p>\n```\nmid\n```mermaid\ngraph TD\nA-->B\n```\nend'
    let prev: ReturnType<typeof scanBlocks> | null = null
    for (let n = 1; n <= doc.length; n++) {
      const partial = scanBlocks(doc.slice(0, n))
      // Every block that is `complete` at prefix n must remain identical at the
      // full document (completed blocks never change once closed).
      for (const b of partial) {
        if (b.complete) {
          const full = scanBlocks(doc).find((f) => f.content === b.content && f.lang === b.lang)
          expect(full, `completed block at prefix ${n} survives to the full doc`).toBeDefined()
        }
      }
      prev = partial
    }
    expect(prev).not.toBeNull()
    // The full document yields exactly the two expected blocks.
    expect(scanBlocks(doc).map((b) => `${b.lang}:${b.complete}`)).toEqual(['html:true', 'mermaid:true'])
  })

  it('handles nested backticks inside a longer fence', () => {
    // An outer fence of four backticks can contain a line of three.
    const src = '````md\nuse ```js\ncode\n``` inline\n````'
    const block = scanBlocks(src)[0]
    expect(block?.complete).toBe(true)
    expect(block?.content).toContain('```js')
  })
})
