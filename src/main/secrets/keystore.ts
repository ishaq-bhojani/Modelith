import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface SecretCrypto {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(cipher: Buffer): string
}

type KeyFile = Record<string, string> // providerId -> base64 ciphertext

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}

export class Keystore {
  // Serializes all mutating operations (set/delete) so that concurrent
  // read-modify-write cycles cannot silently drop each other's writes.
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly crypto: SecretCrypto,
    private readonly filePath: string,
  ) {}

  /** Serializes read-modify-write cycles so concurrent calls cannot lose writes. */
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async load(): Promise<KeyFile> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (err) {
      if (isEnoent(err)) return {}
      throw new Error(`Key store at ${this.filePath} could not be read: ${String(err)}`)
    }
    try {
      return JSON.parse(raw) as KeyFile
    } catch (err) {
      throw new Error(`Key store at ${this.filePath} is corrupt and could not be parsed: ${String(err)}`)
    }
  }

  private async save(data: KeyFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tmpPath, JSON.stringify(data, null, 2), { mode: 0o600 })
    await rename(tmpPath, this.filePath)
  }

  async set(providerId: string, apiKey: string): Promise<void> {
    return this.serialize(async () => {
      if (!this.crypto.isAvailable()) {
        throw new Error('OS encryption is unavailable; refusing to store the key')
      }
      const data = await this.load()
      data[providerId] = this.crypto.encrypt(apiKey).toString('base64')
      await this.save(data)
    })
  }

  async delete(providerId: string): Promise<void> {
    return this.serialize(async () => {
      const data = await this.load()
      delete data[providerId]
      await this.save(data)
    })
  }

  async has(providerId: string): Promise<boolean> {
    return providerId in (await this.load())
  }

  /** Main-process only. Never expose this over IPC. */
  async read(providerId: string): Promise<string | null> {
    const cipher = (await this.load())[providerId]
    if (!cipher) return null
    return this.crypto.decrypt(Buffer.from(cipher, 'base64'))
  }

  async listConfigured(): Promise<string[]> {
    return Object.keys(await this.load())
  }
}
