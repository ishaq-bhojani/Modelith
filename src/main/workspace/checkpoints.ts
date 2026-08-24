import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Pre-image snapshots for one-click rollback (agentic-edits spec §5). Before an
 * approved write is applied, the file's current bytes (or a "did not exist"
 * marker) are recorded here, under userData — never inside the user's folder.
 * A whole turn's edits can then be reverted in reverse order.
 *
 * Universal by design (decision A): plain byte snapshots that work whether or
 * not the workspace is a git repository.
 */
export interface Checkpoint {
  turnId: string
  callId: string
  relPath: string
  /**
   * The workspace root the write was applied in, recorded so the pre-image can
   * only ever go back where it came from. Reverting against whatever root is
   * active instead would restore one project's pre-images over another
   * project's identically-named files. Recorded here rather than resolved from
   * the session at revert time because a checkpoint outlives both: a session
   * can be moved between projects, and a project can be removed (which is
   * non-destructive and leaves its folder on disk) while its checkpoints stay.
   *
   * Optional only because checkpoints written before roots were recorded exist
   * on disk; revert skips those rather than guessing a root for them.
   */
  root?: string
  /** False when the file did not exist before the write (revert => delete it). */
  existed: boolean
  /** The pre-image bytes, base64; empty when !existed. */
  prevBase64: string
}

export class CheckpointStore {
  constructor(private readonly dir: string) {}

  private turnDir(turnId: string): string {
    // callId/turnId are engine-generated UUIDs, but sanitise anyway so a value
    // can never escape the checkpoints directory.
    return path.join(this.dir, turnId.replace(/[^a-zA-Z0-9_-]/g, '_'))
  }

  async record(cp: Checkpoint): Promise<void> {
    const dir = this.turnDir(cp.turnId)
    await mkdir(dir, { recursive: true })
    const file = path.join(dir, `${cp.callId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`)
    await writeFile(file, JSON.stringify(cp))
  }

  /** All checkpoints for a turn, newest first (revert order). */
  async list(turnId: string): Promise<Checkpoint[]> {
    const dir = this.turnDir(turnId)
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      return []
    }
    const out: Checkpoint[] = []
    for (const name of names.filter((n) => n.endsWith('.json'))) {
      try {
        out.push(JSON.parse(await readFile(path.join(dir, name), 'utf8')) as Checkpoint)
      } catch {
        // A corrupt checkpoint is skipped rather than blocking a revert.
      }
    }
    return out.reverse()
  }
}
