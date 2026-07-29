import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Keystore, type SecretCrypto } from '../../src/main/secrets/keystore.js'

// Reversible stand-in for safeStorage; proves the store never writes plaintext.
const fakeCrypto: SecretCrypto = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from([...Buffer.from(plain, 'utf8')].map((b) => b ^ 0x5a)),
  decrypt: (buf) => Buffer.from([...buf].map((b) => b ^ 0x5a)).toString('utf8'),
}

let store: Keystore
let file: string

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oc-keys-'))
  file = join(dir, 'keys.json')
  store = new Keystore(fakeCrypto, file)
})

describe('Keystore', () => {
  it('round-trips a key', async () => {
    await store.set('kimi', 'sk-secret-123')
    expect(await store.read('kimi')).toBe('sk-secret-123')
  })

  it('never writes the plaintext key to disk', async () => {
    await store.set('kimi', 'sk-secret-123')
    expect(await readFile(file, 'utf8')).not.toContain('sk-secret-123')
  })

  it('reports presence without revealing the value', async () => {
    expect(await store.has('kimi')).toBe(false)
    await store.set('kimi', 'sk-secret-123')
    expect(await store.has('kimi')).toBe(true)
  })

  it('deletes a key', async () => {
    await store.set('kimi', 'sk-secret-123')
    await store.delete('kimi')
    expect(await store.has('kimi')).toBe(false)
    expect(await store.read('kimi')).toBeNull()
  })

  it('lists configured providers only', async () => {
    await store.set('kimi', 'a')
    await store.set('anthropic', 'b')
    expect((await store.listConfigured()).sort()).toEqual(['anthropic', 'kimi'])
  })

  it('returns null for an unknown provider', async () => {
    expect(await store.read('nope')).toBeNull()
  })

  it('throws when encryption is unavailable', async () => {
    const broken = new Keystore({ ...fakeCrypto, isAvailable: () => false }, file)
    await expect(broken.set('kimi', 'x')).rejects.toThrow(/encryption/i)
  })
})
