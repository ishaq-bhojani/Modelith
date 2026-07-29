import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface SecretCrypto {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(cipher: Buffer): string
}

type KeyFile = Record<string, string> // providerId -> base64 ciphertext

export class Keystore {
  constructor(
    private readonly crypto: SecretCrypto,
    private readonly filePath: string,
  ) {}

  private async load(): Promise<KeyFile> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as KeyFile
    } catch {
      return {}
    }
  }

  private async save(data: KeyFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(data, null, 2), { mode: 0o600 })
  }

  async set(providerId: string, apiKey: string): Promise<void> {
    if (!this.crypto.isAvailable()) {
      throw new Error('OS encryption is unavailable; refusing to store the key')
    }
    const data = await this.load()
    data[providerId] = this.crypto.encrypt(apiKey).toString('base64')
    await this.save(data)
  }

  async delete(providerId: string): Promise<void> {
    const data = await this.load()
    delete data[providerId]
    await this.save(data)
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
