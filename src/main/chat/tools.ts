import type { ToolSpec } from '../../shared/types.js'
import type { Workspace } from '../workspace/service.js'
import { WorkspaceError } from '../workspace/service.js'
import { applyEdit } from '../workspace/edit-apply.js'

/**
 * The agentic-edit tools (spec §2). Reads auto-run; writes go through the
 * approval gate. Definitions here are the JSON-Schema specs advertised to
 * tool-calling providers; `executeTool` runs them against the confined
 * Workspace, gating every write.
 */
export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'read_file',
    description: 'Read a text file from the workspace. Path is relative to the workspace root.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Workspace-relative file path' } },
      required: ['path'],
    },
  },
  {
    name: 'list_dir',
    description: 'List the workspace file tree (paths relative to the workspace root).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a text file. The change is shown to the user for approval before it is applied.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' },
        content: { type: 'string', description: 'Full new file content' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'apply_edit',
    description: 'Replace an exact, unique snippet in a file with new text. Shown to the user for approval before applying.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' },
        search: { type: 'string', description: 'Exact text to find (must be unique in the file)' },
        replace: { type: 'string', description: 'Text to replace it with' },
      },
      required: ['path', 'search', 'replace'],
    },
  },
]

const READ_ONLY = new Set(['read_file', 'list_dir'])
const WRITE = new Set(['write_file', 'apply_edit'])
export const isKnownTool = (name: string): boolean => READ_ONLY.has(name) || WRITE.has(name)

/**
 * Terminal + git tools (terminal-git spec §1–2). Read-only git tools auto-run;
 * `run_command` and `git_commit` are gated. Offered only when a shell runner is
 * available (a workspace is open).
 */
export const TERMINAL_TOOL_SPECS: ToolSpec[] = [
  {
    name: 'run_command',
    description: 'Run a shell command in the workspace root. Shown to the user for approval before running.',
    parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  },
  { name: 'git_status', description: 'Show git status of the workspace.', parameters: { type: 'object', properties: {} } },
  {
    name: 'git_diff',
    description: 'Show the git diff, optionally for one path.',
    parameters: { type: 'object', properties: { path: { type: 'string' } } },
  },
  { name: 'git_log', description: 'Show recent git commits.', parameters: { type: 'object', properties: {} } },
  {
    name: 'git_commit',
    description: 'Commit staged changes with a message. Shown for approval first.',
    parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
  },
]

/** Shell-quote a single argument for a POSIX or cmd shell (best effort). */
function shellQuote(s: string): string {
  return `"${s.replace(/(["$`\\])/g, '\\$1')}"`
}

/** A write proposed to the user (spec §4). The renderer diffs previous→proposed. */
export interface PendingEdit {
  callId: string
  tool: 'write_file' | 'apply_edit'
  relPath: string
  previous: string | null
  proposed: string
}

export type ApprovalDecision =
  | { action: 'accept' }
  | { action: 'reject' }
  | { action: 'edited'; content: string }

export interface ToolDeps {
  workspace: Workspace
  turnId: string
  /** Ask the user to approve a write; resolves with their decision. */
  requestApproval(edit: PendingEdit): Promise<ApprovalDecision>
  /** Ask the user to approve a non-diff tool call (e.g. MCP); yes/no. */
  requestConfirm?(confirm: { callId: string; name: string; argsJson: string }): Promise<'accept' | 'reject'>
  /** Route an MCP tool call to its server (mcp-client spec §3). */
  mcpCall?(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }>
  /** Run a shell command in the workspace root (terminal-git spec §1). */
  runShell?(command: string): Promise<{ output: string; exitCode: number | null }>
}

export interface ToolOutcome {
  /** Result text fed back to the model as the tool result. */
  result: string
  /** True if the tool errored logically (still returned to the model, not thrown). */
  isError: boolean
}

function parseArgs(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw || '{}') as Record<string, unknown> } catch { return {} }
}

/** Shape a command result into a tool outcome for the model. */
function runResult(r: { output: string; exitCode: number | null }): ToolOutcome {
  const status = r.exitCode === 0 ? '' : `\n[exit code ${r.exitCode}]`
  return { result: (r.output || '(no output)') + status, isError: r.exitCode !== 0 && r.exitCode !== null }
}

function friendlyWorkspaceError(err: unknown): string {
  if (err instanceof WorkspaceError) {
    const map: Record<string, string> = {
      'no-root': 'No workspace folder is open.',
      'too-large': 'That file is too large to read.',
      'not-text': 'That file is not a text file.',
      'outside-root': 'That path is outside the workspace and was refused.',
      'not-found': 'That file or its parent directory does not exist.',
    }
    return map[err.code] ?? err.code
  }
  return err instanceof Error ? err.message : String(err)
}

/** Execute one tool call, gating writes through `requestApproval`. */
export async function executeTool(
  name: string,
  argsRaw: string,
  callId: string,
  deps: ToolDeps,
): Promise<ToolOutcome> {
  const args = parseArgs(argsRaw)
  const { workspace } = deps

  // Terminal + git tools (terminal-git spec §1–2).
  if (name === 'git_status' || name === 'git_diff' || name === 'git_log' || name === 'run_command' || name === 'git_commit') {
    if (!deps.runShell) return { result: 'No workspace is open, so commands cannot run.', isError: true }
    // Read-only git tools auto-run; run_command and git_commit are gated.
    if (name === 'git_status') return runResult(await deps.runShell('git status --short --branch'))
    if (name === 'git_log') return runResult(await deps.runShell('git log --oneline -20'))
    if (name === 'git_diff') {
      const p = args['path'] ? ` -- ${shellQuote(String(args['path']))}` : ''
      return runResult(await deps.runShell(`git diff${p}`))
    }
    // Gated: run_command and git_commit.
    const command = name === 'git_commit'
      ? `git commit -m ${shellQuote(String(args['message'] ?? ''))}`
      : String(args['command'] ?? '')
    if (!command) return { result: 'Missing command.', isError: true }
    if (!deps.requestConfirm) return { result: 'Approval is unavailable.', isError: true }
    const decision = await deps.requestConfirm({ callId, name, argsJson: JSON.stringify({ command }, null, 2) })
    if (decision === 'reject') return { result: 'The user rejected this command; it was not run.', isError: false }
    return runResult(await deps.runShell(command))
  }

  // MCP tools (mcp__server__tool) are gated with a generic confirm, then routed.
  if (name.startsWith('mcp__')) {
    if (!deps.mcpCall || !deps.requestConfirm) return { result: 'MCP is not available.', isError: true }
    const decision = await deps.requestConfirm({ callId, name, argsJson: JSON.stringify(args, null, 2) })
    if (decision === 'reject') return { result: 'The user rejected this tool call; it was not run.', isError: false }
    const out = await deps.mcpCall(name, args)
    return { result: out.text, isError: out.isError }
  }

  try {
    if (name === 'read_file') {
      const { text } = await workspace.read(String(args['path'] ?? ''))
      return { result: text, isError: false }
    }
    if (name === 'list_dir') {
      const tree = await workspace.tree()
      return { result: tree.map((e) => `${e.kind === 'dir' ? '[dir] ' : ''}${e.relPath}`).join('\n'), isError: false }
    }
    if (name === 'write_file' || name === 'apply_edit') {
      const relPath = String(args['path'] ?? '')
      if (!relPath) return { result: 'Missing path.', isError: true }
      const previous = await workspace.currentContent(relPath)

      let proposed: string
      if (name === 'write_file') {
        proposed = String(args['content'] ?? '')
      } else {
        if (previous === null) return { result: friendlyWorkspaceError(new WorkspaceError('not-found')), isError: true }
        const edit = applyEdit(previous, String(args['search'] ?? ''), String(args['replace'] ?? ''))
        if (!edit.ok) {
          const why = edit.error === 'not-found' ? 'the search text was not found'
            : edit.error === 'ambiguous' ? 'the search text matched more than once (make it unique)'
            : 'the search text was empty'
          return { result: `Edit not applied: ${why}.`, isError: true }
        }
        proposed = edit.content
      }

      const decision = await deps.requestApproval({ callId, tool: name, relPath, previous, proposed })
      if (decision.action === 'reject') {
        return { result: 'The user rejected this change; it was not applied.', isError: false }
      }
      const finalContent = decision.action === 'edited' ? decision.content : proposed
      await workspace.applyWrite({ relPath, content: finalContent, turnId: deps.turnId, callId })
      return { result: `Applied change to ${relPath}.`, isError: false }
    }
    return { result: `Unknown tool: ${name}`, isError: true }
  } catch (err) {
    return { result: friendlyWorkspaceError(err), isError: true }
  }
}
