import { spawn } from 'node:child_process'

/** Bounds on a single command run (terminal-git spec §1). */
export const MAX_OUTPUT_BYTES = 100 * 1024
export const DEFAULT_TIMEOUT_MS = 120_000

export interface CommandResult {
  output: string
  exitCode: number | null
  truncated: boolean
  timedOut: boolean
  aborted: boolean
}

export interface RunOptions {
  cwd: string
  signal?: AbortSignal
  timeoutMs?: number
  /** Injected in tests; defaults to the real platform shell invocation. */
  shell?: { command: string; args: (cmd: string) => string[] }
}

function platformShell(): { command: string; args: (cmd: string) => string[] } {
  if (process.platform === 'win32') return { command: 'cmd.exe', args: (cmd) => ['/d', '/s', '/c', cmd] }
  return { command: '/bin/sh', args: (cmd) => ['-c', cmd] }
}

/**
 * Run one shell command in the workspace root and capture its output
 * (terminal-git spec §1). A real shell (so pipelines/globs work) — approval is
 * the guard, not a sandbox. Bounded by an output cap, a wall-clock timeout, and
 * kill-on-abort; no process survives the call.
 *
 * Only for USER-APPROVED commands (`run_command`). For anything the model can
 * trigger without a gate (git status/diff), use `runFile` — a shell string with
 * an interpolated argument is a command-injection vector (`$(…)`/backticks).
 */
export function runCommand(command: string, opts: RunOptions): Promise<CommandResult> {
  const shell = opts.shell ?? platformShell()
  const child = spawn(shell.command, shell.args(command), {
    cwd: opts.cwd, env: process.env, windowsHide: true,
  })
  return capture(child, opts)
}

/**
 * Run a binary with an explicit argument vector and **no shell** — arguments are
 * passed as-is, so nothing in them is ever interpreted by a shell. This is how
 * git is run: a path or commit message from the model (or a hostile repo's own
 * filenames) can never inject a command.
 */
export function runFile(file: string, args: string[], opts: RunOptions): Promise<CommandResult> {
  const child = spawn(file, args, { cwd: opts.cwd, env: process.env, windowsHide: true })
  return capture(child, opts)
}

/** Shared output capture + bounds (cap, timeout, kill-on-abort) for a child. */
function capture(child: ReturnType<typeof spawn>, opts: RunOptions): Promise<CommandResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return new Promise<CommandResult>((resolve) => {
    let output = ''
    let truncated = false
    let timedOut = false
    let aborted = false
    let settled = false

    const append = (chunk: Buffer) => {
      if (truncated) return
      const room = MAX_OUTPUT_BYTES - Buffer.byteLength(output)
      if (room <= 0) { truncated = true; return }
      const text = chunk.toString('utf8')
      if (Buffer.byteLength(text) > room) { output += text.slice(0, room); truncated = true }
      else output += text
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)

    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs)
    const onAbort = () => { aborted = true; child.kill('SIGKILL') }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const finish = (exitCode: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({ output, exitCode, truncated, timedOut, aborted })
    }
    child.on('error', (err) => { output += `\n[failed to start: ${err.message}]`; finish(null) })
    child.on('close', (code) => finish(code))
  })
}
