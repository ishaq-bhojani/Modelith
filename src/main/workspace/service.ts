import { dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import { mkdir, readdir, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppSettingsStore } from '../settings/store.js'
import type { WorkspaceTreeEntry as TreeEntry } from '../../shared/types.js'
import { isIgnored, isInsideRoot } from './paths.js'
import type { CheckpointStore } from './checkpoints.js'

/** Per-file text cap, matching the composer's text-attach ceiling (spec §A.2). */
const MAX_BYTES = 256 * 1024
/** Guard against a pathological tree; the UI lists at most this many entries. */
const MAX_ENTRIES = 5000

export type { TreeEntry }

/** A typed workspace error whose `code` the renderer maps to a message. */
export class WorkspaceError extends Error {
  constructor(readonly code: 'no-root' | 'too-large' | 'not-text' | 'outside-root' | 'not-found') {
    super(code)
    this.name = 'WorkspaceError'
  }
}

/**
 * Read-only access to a user-chosen workspace folder (spec §A). Every read is
 * confined to the dialog-chosen root: the renderer never supplies the root, and
 * a path that resolves outside it (via `..` or a symlink) is rejected. Nothing
 * is written or executed.
 */
export class Workspace {
  constructor(
    private readonly settings: AppSettingsStore,
    private readonly getWindow: () => BrowserWindow | undefined,
    private readonly checkpoints?: CheckpointStore,
  ) {}

  /** Open the native directory picker; persist and return the chosen root. */
  async pick(): Promise<string | null> {
    // Test seam: the native dialog cannot be driven in E2E, so when this env var
    // is set (only in tests) the picker resolves to it directly. It never
    // changes the security model — main still holds the root and confines reads.
    const testRoot = process.env['MODELITH_WORKSPACE_ROOT']
    if (testRoot) {
      await this.settings.set({ workspaceRoot: testRoot })
      return testRoot
    }
    const window = this.getWindow()
    const result = await (window
      ? dialog.showOpenDialog(window, { properties: ['openDirectory'] })
      : dialog.showOpenDialog({ properties: ['openDirectory'] }))
    if (result.canceled || result.filePaths.length === 0) return null
    const root = result.filePaths[0]!
    await this.settings.set({ workspaceRoot: root })
    return root
  }

  /** The remembered workspace root, or null when none has been chosen. */
  async current(): Promise<string | null> {
    const root = (await this.settings.get())['workspaceRoot']
    return typeof root === 'string' ? root : null
  }

  /** A pruned, capped listing of the current root (dirs first per level). */
  async tree(): Promise<TreeEntry[]> {
    const root = await this.current()
    if (!root) throw new WorkspaceError('no-root')
    const entries: TreeEntry[] = []
    await this.walk(root, root, entries)
    return entries
  }

  private async walk(root: string, dir: string, out: TreeEntry[]): Promise<void> {
    if (out.length >= MAX_ENTRIES) return
    let dirents
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      return // unreadable directory — skip rather than fail the whole tree
    }
    // Directories first, then files; each group alphabetical.
    dirents.sort((a, b) => {
      const ad = a.isDirectory() ? 0 : 1
      const bd = b.isDirectory() ? 0 : 1
      return ad - bd || a.name.localeCompare(b.name)
    })
    for (const dirent of dirents) {
      if (out.length >= MAX_ENTRIES) return
      // Do not follow symlinks — a symlinked dir could point outside the root.
      if (dirent.isSymbolicLink()) continue
      const abs = path.join(dir, dirent.name)
      const relPath = path.relative(root, abs).split(path.sep).join('/')
      if (isIgnored(relPath)) continue
      if (dirent.isDirectory()) {
        out.push({ relPath, name: dirent.name, kind: 'dir', readable: false })
        await this.walk(root, abs, out)
      } else if (dirent.isFile()) {
        let size: number | undefined
        try { size = (await stat(abs)).size } catch { size = undefined }
        out.push({
          relPath,
          name: dirent.name,
          kind: 'file',
          ...(size !== undefined ? { size } : {}),
          readable: size !== undefined && size <= MAX_BYTES,
        })
      }
    }
  }

  /** Read one text file under the root, enforcing confinement (spec §A.2). */
  async read(relPath: string): Promise<{ relPath: string; text: string }> {
    const root = await this.current()
    if (!root) throw new WorkspaceError('no-root')

    const realRoot = await realpath(root)
    const candidate = path.resolve(realRoot, relPath)
    let realCandidate: string
    try {
      realCandidate = await realpath(candidate)
    } catch {
      throw new WorkspaceError('not-found')
    }
    // The security gate: the resolved real path must be inside the real root.
    const posix = (p: string) => p.split(path.sep).join('/')
    if (!isInsideRoot(posix(realRoot), posix(realCandidate))) {
      throw new WorkspaceError('outside-root')
    }

    const info = await stat(realCandidate)
    if (!info.isFile()) throw new WorkspaceError('not-found')
    if (info.size > MAX_BYTES) throw new WorkspaceError('too-large')

    const buffer = await readFile(realCandidate)
    if (isBinary(buffer)) throw new WorkspaceError('not-text')
    return { relPath, text: buffer.toString('utf8') }
  }

  // ── Writes (agentic edits, spec §5–6) ────────────────────────────────────

  /**
   * Resolve a write target inside the root. The parent directory must already
   * exist (v1), so its realpath defends against a symlinked ancestor escaping
   * the root; the effective target is the real parent joined with the basename.
   */
  private async resolveWritable(root: string, relPath: string): Promise<string> {
    const realRoot = await realpath(root)
    const candidate = path.resolve(realRoot, relPath)
    let realParent: string
    try {
      realParent = await realpath(path.dirname(candidate))
    } catch {
      throw new WorkspaceError('not-found')
    }
    const effective = path.join(realParent, path.basename(candidate))
    const posix = (p: string) => p.split(path.sep).join('/')
    if (!isInsideRoot(posix(realRoot), posix(effective))) throw new WorkspaceError('outside-root')
    return effective
  }

  /** Current text of a file for computing a diff, or null if it does not exist. */
  async currentContent(relPath: string): Promise<string | null> {
    const root = await this.current()
    if (!root) throw new WorkspaceError('no-root')
    const target = await this.resolveWritable(root, relPath)
    try {
      return await readFile(target, 'utf8')
    } catch {
      return null
    }
  }

  /** Apply an approved write, snapshotting the pre-image first (reversible). */
  async applyWrite(input: WriteInput): Promise<void> {
    const root = await this.current()
    if (!root) throw new WorkspaceError('no-root')
    const target = await this.resolveWritable(root, input.relPath)

    let existed = true
    let prev = Buffer.alloc(0)
    try { prev = await readFile(target) } catch { existed = false }

    await this.checkpoints?.record({
      turnId: input.turnId,
      callId: input.callId,
      relPath: input.relPath,
      existed,
      prevBase64: existed ? prev.toString('base64') : '',
    })
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, input.content, 'utf8')
  }

  /** Restore every pre-image recorded for a turn (newest first). */
  async revertTurn(turnId: string): Promise<number> {
    const root = await this.current()
    if (!root) throw new WorkspaceError('no-root')
    const cps = (await this.checkpoints?.list(turnId)) ?? []
    let reverted = 0
    for (const cp of cps) {
      let target: string
      try { target = await this.resolveWritable(root, cp.relPath) } catch { continue }
      if (cp.existed) await writeFile(target, Buffer.from(cp.prevBase64, 'base64'))
      else await unlink(target).catch(() => {})
      reverted++
    }
    return reverted
  }
}

export interface WriteInput { relPath: string; content: string; turnId: string; callId: string }

/** A NUL byte in the first 8 KB is the cheap, reliable "this is binary" signal. */
function isBinary(buffer: Buffer): boolean {
  const end = Math.min(buffer.length, 8192)
  for (let i = 0; i < end; i++) if (buffer[i] === 0) return true
  return false
}
