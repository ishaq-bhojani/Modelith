import { describe, it, expect } from 'vitest'
import { executeTool, isKnownTool, TOOL_SPECS } from '../../src/main/chat/tools.js'
import type { ToolDeps } from '../../src/main/chat/tools.js'
import type { SearchResult } from '../../src/main/workspace/service.js'

function deps(search: (q: string) => Promise<SearchResult>): ToolDeps {
  return {
    workspace: { search } as unknown as ToolDeps['workspace'],
    turnId: 't1',
    requestApproval: async () => ({ action: 'reject' }),
  }
}

describe('search_files tool', () => {
  it('is advertised and known', () => {
    expect(TOOL_SPECS.some((t) => t.name === 'search_files')).toBe(true)
    expect(isKnownTool('search_files')).toBe(true)
  })

  it('formats hits as relPath:line: text and auto-runs (no approval)', async () => {
    const out = await executeTool('search_files', JSON.stringify({ query: 'foo' }), 'c1', deps(
      async () => ({ hits: [{ relPath: 'src/a.ts', line: 3, text: 'const foo = 1' }], truncated: false, filesScanned: 1 }),
    ))
    expect(out.isError).toBe(false)
    expect(out.result).toContain('src/a.ts:3: const foo = 1')
  })

  it('notes truncation', async () => {
    const out = await executeTool('search_files', JSON.stringify({ query: 'foo' }), 'c1', deps(
      async () => ({ hits: [{ relPath: 'a', line: 1, text: 'foo' }], truncated: true, filesScanned: 9 }),
    ))
    expect(out.result.toLowerCase()).toContain('truncat')
  })

  it('reports no matches clearly', async () => {
    const out = await executeTool('search_files', JSON.stringify({ query: 'zzz' }), 'c1', deps(
      async () => ({ hits: [], truncated: false, filesScanned: 4 }),
    ))
    expect(out.isError).toBe(false)
    expect(out.result.toLowerCase()).toContain('no matches')
  })
})
