import { useState } from 'react'
import type { WorkspaceTreeEntry } from '@shared/types'
import { IconFolder } from '../app/icons.js'

export interface TreeNode {
  name: string
  relPath: string
  kind: 'file' | 'dir'
  readable: boolean
  size?: number
  children: TreeNode[]
}

/** Group a flat, already-confined entry list into a nested, ordered tree. */
export function buildTree(entries: WorkspaceTreeEntry[]): TreeNode[] {
  const rootChildren: TreeNode[] = []
  const byPath = new Map<string, TreeNode>()

  const ensureDir = (relPath: string): TreeNode => {
    const existing = byPath.get(relPath)
    if (existing) return existing
    const name = relPath.split('/').pop()!
    const node: TreeNode = { name, relPath, kind: 'dir', readable: false, children: [] }
    byPath.set(relPath, node)
    const parent = relPath.includes('/') ? ensureDir(relPath.slice(0, relPath.lastIndexOf('/'))) : null
    ;(parent ? parent.children : rootChildren).push(node)
    return node
  }

  for (const entry of entries) {
    if (entry.kind === 'dir') { ensureDir(entry.relPath); continue }
    const name = entry.name
    const node: TreeNode = {
      name, relPath: entry.relPath, kind: 'file', readable: entry.readable,
      ...(entry.size !== undefined ? { size: entry.size } : {}), children: [],
    }
    byPath.set(entry.relPath, node)
    const parentPath = entry.relPath.includes('/') ? entry.relPath.slice(0, entry.relPath.lastIndexOf('/')) : ''
    ;(parentPath ? ensureDir(parentPath).children : rootChildren).push(node)
  }

  const sort = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
    for (const n of nodes) if (n.children.length) sort(n.children)
    return nodes
  }
  return sort(rootChildren)
}

interface RowProps { node: TreeNode; depth: number; onAddFile: (relPath: string) => void }

function Row({ node, depth, onAddFile }: RowProps): React.JSX.Element {
  const [open, setOpen] = useState(depth < 1) // top level expanded by default
  const pad = { paddingLeft: `${8 + depth * 12}px` }
  if (node.kind === 'dir') {
    return (
      <div>
        <div className="tree-row tree-dir" style={pad} data-testid="tree-dir" onClick={() => setOpen((v) => !v)}>
          <span className="tree-caret">{open ? '▾' : '▸'}</span>
          <IconFolder size={12} /> <span className="tree-name">{node.name}</span>
        </div>
        {open ? node.children.map((c) => <Row key={c.relPath} node={c} depth={depth + 1} onAddFile={onAddFile} />) : null}
      </div>
    )
  }
  return (
    <div className={`tree-row tree-file${node.readable ? '' : ' tree-file-disabled'}`} style={pad} data-testid="tree-file">
      <span className="tree-name" title={node.relPath}>{node.name}</span>
      {node.readable ? (
        <button className="tree-add" data-testid="tree-add" title="Add to message" onClick={() => onAddFile(node.relPath)}>＋</button>
      ) : null}
    </div>
  )
}

export function WorkspaceTree({ entries, onAddFile }: { entries: WorkspaceTreeEntry[]; onAddFile: (relPath: string) => void }): React.JSX.Element {
  const nodes = buildTree(entries)
  if (nodes.length === 0) return <p className="inspector-empty">No files.</p>
  return <div className="tree" data-testid="workspace-tree">{nodes.map((n) => <Row key={n.relPath} node={n} depth={0} onAddFile={onAddFile} />)}</div>
}
