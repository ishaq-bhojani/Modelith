import { describe, it, expect } from 'vitest'
import { deriveArtifacts } from '../../src/renderer/canvas/artifacts.js'
import type { ChatMessage } from '../../src/shared/types.js'

const assistant = (id: string, content: string): ChatMessage =>
  ({ id, role: 'assistant', content, createdAt: 0 })
const user = (id: string, content: string): ChatMessage =>
  ({ id, role: 'user', content, createdAt: 0 })

describe('deriveArtifacts', () => {
  it('creates one artifact from a single html block', () => {
    const arts = deriveArtifacts([assistant('a', '```html\n<h1>hi</h1>\n```')], '')
    expect(arts).toHaveLength(1)
    expect(arts[0]?.lang).toBe('html')
    expect(arts[0]?.versions).toEqual(['<h1>hi</h1>'])
    expect(arts[0]?.currentIndex).toBe(0)
  })

  it('treats a later block of the same language as a new version', () => {
    const arts = deriveArtifacts([
      assistant('a', '```html\n<h1>v1</h1>\n```'),
      assistant('b', '```html\n<h1>v2</h1>\n```'),
    ], '')
    expect(arts).toHaveLength(1)
    expect(arts[0]?.versions).toEqual(['<h1>v1</h1>', '<h1>v2</h1>'])
    // currentIndex defaults to the newest version.
    expect(arts[0]?.currentIndex).toBe(1)
  })

  it('keeps different languages as separate artifacts, in first-seen order', () => {
    const arts = deriveArtifacts([
      assistant('a', '```svg\n<svg/>\n```\n```html\n<b/>\n```'),
    ], '')
    expect(arts.map((a) => a.lang)).toEqual(['svg', 'html'])
  })

  it('normalizes mmd to mermaid', () => {
    const arts = deriveArtifacts([assistant('a', '```mmd\ngraph TD\nA-->B\n```')], '')
    expect(arts[0]?.lang).toBe('mermaid')
  })

  it('ignores non-canvas languages', () => {
    expect(deriveArtifacts([assistant('a', '```js\nconst x = 1\n```')], '')).toEqual([])
  })

  it('ignores blocks in user messages', () => {
    expect(deriveArtifacts([user('u', '```html\n<h1>from user</h1>\n```')], '')).toEqual([])
  })

  it('includes the in-flight streaming block as the newest (provisional) version', () => {
    const arts = deriveArtifacts(
      [assistant('a', '```html\n<h1>done</h1>\n```')],
      '```html\n<h1>streaming',
    )
    expect(arts[0]?.versions).toEqual(['<h1>done</h1>', '<h1>streaming'])
    expect(arts[0]?.currentIndex).toBe(1)
  })

  it('does not multiply versions across re-derivations of the same streaming block', () => {
    // Pure recomputation each token means the growing block is always exactly
    // one version, never one-per-token.
    const a1 = deriveArtifacts([], '```html\n<div>')
    const a2 = deriveArtifacts([], '```html\n<div><p>more')
    expect(a1[0]?.versions).toHaveLength(1)
    expect(a2[0]?.versions).toHaveLength(1)
    expect(a2[0]?.versions[0]).toBe('<div><p>more')
  })

  it('collects blocks in document order within one message', () => {
    const arts = deriveArtifacts([
      assistant('a', '```html\n<a>\n```\ntext\n```html\n<b>\n```'),
    ], '')
    expect(arts[0]?.versions).toEqual(['<a>', '<b>'])
  })

  it('returns nothing when there are no canvas blocks', () => {
    expect(deriveArtifacts([assistant('a', 'just prose')], '')).toEqual([])
  })
})
