import { describe, it, expect } from 'vitest'
import { splitLines } from '../../src/main/mcp/line-buffer.js'

describe('splitLines', () => {
  it('returns complete lines and carries the remainder', () => {
    const r = splitLines('', '{"a":1}\n{"b":2}\n{"c"')
    expect(r.lines).toEqual(['{"a":1}', '{"b":2}'])
    expect(r.carry).toBe('{"c"')
  })

  it('joins a carried partial with the next chunk', () => {
    const first = splitLines('', '{"a":')
    expect(first.lines).toEqual([])
    const second = splitLines(first.carry, '1}\n')
    expect(second.lines).toEqual(['{"a":1}'])
    expect(second.carry).toBe('')
  })

  it('ignores empty lines between messages', () => {
    const r = splitLines('', 'x\n\ny\n')
    expect(r.lines).toEqual(['x', 'y'])
  })
})
