import { describe, it, expect } from 'vitest'
import { parseSse } from '../../src/main/chat/sse-parser.js'

describe('parseSse', () => {
  it('parses one complete record', () => {
    const r = parseSse('data: {"a":1}\n\n', '')
    expect(r.events).toEqual([{ data: '{"a":1}' }])
    expect(r.residual).toBe('')
  })

  it('holds an incomplete record in the residual', () => {
    const r = parseSse('data: {"a"', '')
    expect(r.events).toEqual([])
    expect(r.residual).toBe('data: {"a"')
  })

  it('joins a record split across chunks', () => {
    const a = parseSse('data: {"a"', '')
    const b = parseSse(':1}\n\n', a.residual)
    expect(b.events).toEqual([{ data: '{"a":1}' }])
  })

  it('captures the event field used by Anthropic', () => {
    const r = parseSse('event: content_block_delta\ndata: {"x":2}\n\n', '')
    expect(r.events).toEqual([{ event: 'content_block_delta', data: '{"x":2}' }])
  })

  it('joins multi-line data with newlines', () => {
    const r = parseSse('data: line1\ndata: line2\n\n', '')
    expect(r.events).toEqual([{ data: 'line1\nline2' }])
  })

  it('ignores comment heartbeats', () => {
    const r = parseSse(': ping\n\ndata: ok\n\n', '')
    expect(r.events).toEqual([{ data: 'ok' }])
  })

  it('emits the [DONE] sentinel as data for the caller to interpret', () => {
    expect(parseSse('data: [DONE]\n\n', '').events).toEqual([{ data: '[DONE]' }])
  })

  it('handles CRLF line endings', () => {
    expect(parseSse('data: {"a":1}\r\n\r\n', '').events).toEqual([{ data: '{"a":1}' }])
  })

  it('parses several records in one chunk', () => {
    const r = parseSse('data: one\n\ndata: two\n\n', '')
    expect(r.events.map((e) => e.data)).toEqual(['one', 'two'])
  })

  it('produces identical output regardless of chunking', () => {
    const doc = 'data: a\n\nevent: x\ndata: b\n\n: c\n\ndata: d\n\n'
    for (let size = 1; size <= doc.length; size++) {
      let residual = ''
      const all: { data: string }[] = []
      for (let i = 0; i < doc.length; i += size) {
        const r = parseSse(doc.slice(i, i + size), residual)
        residual = r.residual
        all.push(...r.events)
      }
      expect(all.map((e) => e.data)).toEqual(['a', 'b', 'd'])
    }
  })
})
