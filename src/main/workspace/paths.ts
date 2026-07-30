import path from 'node:path'

/**
 * Whether `candidate` is the root or lives inside it — the containment decision
 * behind every workspace read (spec §A.2). Both arguments must already be
 * absolute; the caller resolves and realpaths them first so that `..` and
 * symlinks are collapsed before this pure check runs.
 *
 * Uses `path.relative`: a path is inside the root iff the relative path from the
 * root to it neither starts with `..` nor is itself absolute. This is immune to
 * the sibling-prefix bug (`/root` vs `/root-evil`) that a naive `startsWith`
 * would fall for.
 */
export function isInsideRoot(root: string, candidate: string): boolean {
  const rel = path.posix.relative(normalize(root), normalize(candidate))
  if (rel === '') return true // candidate === root
  return !rel.startsWith('..') && !path.posix.isAbsolute(rel)
}

/** Strip a single trailing slash so `/root/` and `/root` compare equal. */
function normalize(p: string): string {
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p
}

/** Directories pruned from the tree by default — noise, not source (spec §A.3). */
const IGNORED = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', '.next', '.cache',
  '.turbo', 'coverage', '.venv', '__pycache__', '.DS_Store',
])

/** Whether any segment of a workspace-relative path is a default-ignored dir. */
export function isIgnored(relPath: string): boolean {
  return relPath.split(/[\\/]/).some((seg) => IGNORED.has(seg))
}
