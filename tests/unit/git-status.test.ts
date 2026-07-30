import { describe, it, expect } from 'vitest'
import { parseStatus } from '../../src/main/terminal/git.js'

describe('parseStatus', () => {
  it('extracts the branch and changed files from porcelain output', () => {
    const out = [
      '## main...origin/main [ahead 1]',
      ' M src/a.ts',
      'A  src/b.ts',
      '?? new.txt',
    ].join('\n')
    const s = parseStatus(out)
    expect(s.isRepo).toBe(true)
    expect(s.branch).toBe('main')
    expect(s.files).toEqual([
      { path: 'src/a.ts', staged: false, work: 'M' },
      { path: 'src/b.ts', staged: true, work: 'A' },
      { path: 'new.txt', staged: false, work: '?' },
    ])
  })

  it('handles a clean repo with just the branch line', () => {
    const s = parseStatus('## main')
    expect(s.branch).toBe('main')
    expect(s.files).toEqual([])
  })
})
