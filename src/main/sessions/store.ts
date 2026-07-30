import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { ChatMessage } from '../../shared/types.js'

export interface SessionMeta {
  id: string
  title: string
  updatedAt: number
  /** Pinned sessions sort to the top of the sidebar. */
  pinned?: boolean
  /** Archived sessions are hidden from the sidebar unless explicitly shown. */
  archived?: boolean
  /** Free-form tags for filtering. */
  tags?: string[]
}

// randomUUID() output (hex digits and hyphens only) always satisfies this.
const SAFE_ID = /^[A-Za-z0-9-]+$/

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}

export class SessionStore {
  // Serializes all index read-modify-write cycles (create/append/remove/rename)
  // so concurrent calls cannot silently drop each other's updates. Mirrors the
  // approach in src/main/secrets/keystore.ts.
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly dir: string) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private path(id: string): string {
    if (!SAFE_ID.test(id)) throw new Error(`Invalid session id: ${id}`)
    return join(this.dir, `${id}.jsonl`)
  }

  private get indexPath(): string {
    return join(this.dir, 'index.json')
  }

  private async readIndex(): Promise<SessionMeta[]> {
    let raw: string
    try {
      raw = await readFile(this.indexPath, 'utf8')
    } catch (err) {
      if (isEnoent(err)) return []
      throw new Error(`Session index at ${this.indexPath} could not be read: ${String(err)}`)
    }
    try {
      return JSON.parse(raw) as SessionMeta[]
    } catch (err) {
      throw new Error(`Session index at ${this.indexPath} is corrupt and could not be parsed: ${String(err)}`)
    }
  }

  private async writeIndex(entries: SessionMeta[]): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const tmpPath = `${this.indexPath}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tmpPath, JSON.stringify(entries, null, 2))
    await rename(tmpPath, this.indexPath)
  }

  async create(title: string): Promise<SessionMeta> {
    return this.serialize(async () => {
      const meta: SessionMeta = { id: randomUUID(), title, updatedAt: Date.now() }
      // Write the index entry before the (empty) message file: if the index
      // write fails (e.g. a corrupt index), we must not leave an orphaned
      // .jsonl file that no index entry references and no caller learned the
      // id for. The reverse failure — an index entry with no file yet — is
      // benign, since load() already treats a missing file as an empty session.
      await this.writeIndex([meta, ...(await this.readIndex())])
      await mkdir(this.dir, { recursive: true })
      await writeFile(this.path(meta.id), '')
      return meta
    })
  }

  async append(id: string, message: ChatMessage): Promise<void> {
    await appendFile(this.path(id), `${JSON.stringify(message)}\n`)
    return this.serialize(async () => {
      const index = await this.readIndex()
      const entry = index.find((s) => s.id === id)
      if (entry) {
        entry.updatedAt = Date.now()
        await this.writeIndex(index)
      }
    })
  }

  /** Skips any trailing partial line, so a crash mid-write costs one message. */
  async load(id: string): Promise<ChatMessage[]> {
    // Resolve (and validate) the path outside the try below: an invalid id must
    // reject, not be swallowed together with a genuine missing-file ENOENT.
    const filePath = this.path(id)
    let raw: string
    try {
      raw = await readFile(filePath, 'utf8')
    } catch (err) {
      // A genuinely missing file (e.g. a session whose .jsonl was never
      // written, or one already removed) is legitimately empty. Anything
      // else — EACCES, EIO, EBUSY, a permissions change mid-session — must
      // not present as an empty conversation: the caller would silently
      // start appending on top of history the user still believes exists.
      // Mirrors readIndex()'s ENOENT-vs-everything-else split above.
      if (isEnoent(err)) return []
      throw new Error(`Session file at ${filePath} could not be read: ${String(err)}`)
    }
    const out: ChatMessage[] = []
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue
      try {
        out.push(JSON.parse(line) as ChatMessage)
      } catch {
        /* truncated tail */
      }
    }
    return out
  }

  async list(): Promise<SessionMeta[]> {
    return (await this.readIndex()).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async remove(id: string): Promise<void> {
    return this.serialize(async () => {
      await rm(this.path(id), { force: true })
      await this.writeIndex((await this.readIndex()).filter((s) => s.id !== id))
    })
  }

  async rename(id: string, title: string): Promise<void> {
    return this.mutateEntry(id, (entry) => { entry.title = title })
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    return this.mutateEntry(id, (entry) => { entry.pinned = pinned })
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    return this.mutateEntry(id, (entry) => { entry.archived = archived })
  }

  async setTags(id: string, tags: string[]): Promise<void> {
    return this.mutateEntry(id, (entry) => { entry.tags = tags })
  }

  /** Shared index read-modify-write for the metadata setters above. */
  private async mutateEntry(id: string, mutate: (entry: SessionMeta) => void): Promise<void> {
    return this.serialize(async () => {
      const index = await this.readIndex()
      const entry = index.find((s) => s.id === id)
      if (entry) {
        mutate(entry)
        await this.writeIndex(index)
      }
    })
  }

  /**
   * Rewrites a session's entire message file atomically (temp file + rename,
   * the same durability pattern writeIndex uses). Editing a message and
   * branching both need to produce a file that is an edited copy or a prefix of
   * another — neither of which the append-only hot path can express. This is the
   * rare, explicit case; normal turns still append.
   */
  async replaceMessages(id: string, messages: ChatMessage[]): Promise<void> {
    const filePath = this.path(id)
    await mkdir(this.dir, { recursive: true })
    const body = messages.map((m) => JSON.stringify(m)).join('\n')
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tmpPath, body.length > 0 ? `${body}\n` : '')
    await rename(tmpPath, filePath)
    await this.mutateEntry(id, (entry) => { entry.updatedAt = Date.now() })
  }

  /**
   * Drops the message with `messageId` and everything after it, keeping the
   * prefix before it. Used when a user edits a message: the conversation is
   * rewound to just before that turn, then the edited turn is sent fresh.
   */
  async truncateFrom(id: string, messageId: string): Promise<void> {
    const messages = await this.load(id)
    const cut = messages.findIndex((m) => m.id === messageId)
    if (cut === -1) return
    await this.replaceMessages(id, messages.slice(0, cut))
  }

  /** Rewrites one message's content in place (edit an assistant reply). */
  async editMessage(id: string, messageId: string, content: string): Promise<void> {
    const messages = await this.load(id)
    const target = messages.find((m) => m.id === messageId)
    if (!target) return
    await this.replaceMessages(id, messages.map((m) => (m.id === messageId ? { ...m, content } : m)))
  }

  /**
   * Creates a new session containing the source session's messages up to and
   * including `uptoId`. Used by "Fork here". Returns the new session's meta.
   */
  async branch(sourceId: string, uptoId: string, title: string): Promise<SessionMeta> {
    const source = await this.load(sourceId)
    const cutoff = source.findIndex((m) => m.id === uptoId)
    const slice = cutoff === -1 ? source : source.slice(0, cutoff + 1)
    const meta = await this.create(title)
    await this.replaceMessages(meta.id, slice)
    return meta
  }
}
