import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}

/**
 * A tiny persisted key/value store for app preferences (currently the failover
 * chain; a natural home for other non-secret settings later). Reads return the
 * whole object; writes merge a patch. Atomic (temp file + rename) and
 * serialized, mirroring the durability the session index and keystore use, so
 * concurrent writes cannot lose each other.
 *
 * Secrets never live here — those stay in the OS keychain via Keystore.
 */
export class AppSettingsStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  async get(): Promise<Record<string, unknown>> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (err) {
      if (isEnoent(err)) return {}
      throw new Error(`Settings at ${this.filePath} could not be read: ${String(err)}`)
    }
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      // A corrupt settings file is non-critical: fall back to defaults rather
      // than blocking the app. (Unlike the session index, no user content is
      // lost — these are only preferences.)
      return {}
    }
  }

  async set(patch: Record<string, unknown>): Promise<void> {
    return this.serialize(async () => {
      const current = await this.get()
      const next = { ...current, ...patch }
      await mkdir(dirname(this.filePath), { recursive: true })
      const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
      await writeFile(tmpPath, JSON.stringify(next, null, 2))
      await rename(tmpPath, this.filePath)
    })
  }

  static defaultPath(userDataDir: string): string {
    return join(userDataDir, 'settings.json')
  }
}
