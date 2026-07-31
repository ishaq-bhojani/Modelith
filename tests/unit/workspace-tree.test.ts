import { describe, it, expect } from 'vitest'
import { buildTree } from '../../src/renderer/chat/WorkspaceTree.js'
import type { WorkspaceTreeEntry } from '../../src/shared/types.js'

const e = (relPath: string, kind: 'file' | 'dir'): WorkspaceTreeEntry => ({
  relPath, name: relPath.split('/').pop()!, kind, readable: kind === 'file',
})

describe('buildTree', () => {
  it('nests files under their directories', () => {
    const nodes = buildTree([e('src', 'dir'), e('src/a.ts', 'file'), e('README.md', 'file')])
    const src = nodes.find((n) => n.name === 'src')!
    expect(src.kind).toBe('dir')
    expect(src.children.map((c) => c.name)).toEqual(['a.ts'])
    expect(nodes.some((n) => n.name === 'README.md' && n.kind === 'file')).toBe(true)
  })

  it('orders directories before files at each level', () => {
    const nodes = buildTree([e('z.txt', 'file'), e('lib', 'dir'), e('lib/x.ts', 'file')])
    expect(nodes[0]!.kind).toBe('dir')
    expect(nodes[0]!.name).toBe('lib')
    expect(nodes[1]!.name).toBe('z.txt')
  })

  it('synthesizes intermediate directories missing from the flat list', () => {
    const nodes = buildTree([e('a/b/c.ts', 'file')])
    const a = nodes.find((n) => n.name === 'a')!
    const b = a.children.find((n) => n.name === 'b')!
    expect(b.children[0]!.name).toBe('c.ts')
  })
})
