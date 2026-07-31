import { runFile } from './runner.js'
import type { Workspace } from '../workspace/service.js'
import type { GitFile, GitStatus } from '../../shared/types.js'

/**
 * View-only git state for the Git panel (terminal-git spec §2). Runs the git
 * binary in the workspace root and parses porcelain output; commits are not
 * done here (that is the model's gated `git_commit` tool).
 */
export class GitService {
  constructor(private readonly workspace: Workspace) {}

  private async root(): Promise<string | null> { return this.workspace.current() }

  async status(): Promise<GitStatus> {
    const root = await this.root()
    if (!root) return { isRepo: false, branch: null, files: [] }
    // -uall lists untracked FILES individually instead of collapsing them into a
    // bare "dir/" entry that has no useful diff. Run via arg-vector (no shell).
    const r = await runFile('git', ['status', '--porcelain=v1', '-uall', '--branch'], { cwd: root, timeoutMs: 15_000 })
    if (r.exitCode !== 0) return { isRepo: false, branch: null, files: [] }
    return parseStatus(r.output)
  }

  async diff(path?: string): Promise<string> {
    const root = await this.root()
    if (!root) return ''
    // Arg-vector: `path` (a repo filename, which a hostile repo controls) is
    // passed to git verbatim and can never reach a shell.
    const r = await runFile('git', path ? ['diff', '--', path] : ['diff'], { cwd: root, timeoutMs: 15_000 })
    if (r.output.trim() !== '' || !path) return r.output
    // An untracked file produces no `git diff`; show it as an all-added diff so a
    // new file still has something to look at.
    const nul = process.platform === 'win32' ? 'NUL' : '/dev/null'
    const untracked = await runFile('git', ['diff', '--no-index', '--', nul, path], { cwd: root, timeoutMs: 15_000 })
    return untracked.output
  }
}

/** Parse `git status --porcelain=v1 --branch` into a structured status. */
export function parseStatus(output: string): GitStatus {
  const lines = output.split('\n')
  let branch: string | null = null
  const files: GitFile[] = []
  for (const line of lines) {
    if (line.startsWith('## ')) {
      // e.g. "## main...origin/main [ahead 1]" → "main"
      branch = line.slice(3).split(/\.\.\.|\s/)[0] ?? null
      continue
    }
    if (line.length < 3) continue
    const index = line[0]!
    const work = line[1]!
    const path = line.slice(3)
    files.push({ path, staged: index !== ' ' && index !== '?', work: work === ' ' ? index : work })
  }
  return { isRepo: true, branch, files }
}
