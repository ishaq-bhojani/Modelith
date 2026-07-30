import { describe, it, expect } from 'vitest'
import { scanSecrets } from '../../src/shared/secret-scan.js'

describe('scanSecrets', () => {
  it('finds nothing in ordinary prose', () => {
    expect(scanSecrets('Please refactor the streaming parser and explain the change.')).toEqual([])
  })

  it('finds nothing in a normal code snippet', () => {
    const code = 'const x = fetchUser(id)\nif (!x) throw new Error("missing")'
    expect(scanSecrets(code)).toEqual([])
  })

  it('detects an OpenAI-style key', () => {
    const hits = scanSecrets('here is my key sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD1234 use it')
    expect(hits.some((h) => h.category === 'api-key')).toBe(true)
  })

  it('detects an AWS access key id', () => {
    const hits = scanSecrets('AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE')
    expect(hits.some((h) => h.category === 'aws-key')).toBe(true)
  })

  it('detects a private key header', () => {
    const hits = scanSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIE...')
    expect(hits.some((h) => h.category === 'private-key')).toBe(true)
  })

  it('detects a .env-style secret assignment', () => {
    const hits = scanSecrets('DATABASE_PASSWORD=hunter2supersecretvalue')
    expect(hits.some((h) => h.category === 'env-secret')).toBe(true)
  })

  it('does not flag an ordinary env assignment with a short non-secret value', () => {
    expect(scanSecrets('NODE_ENV=production')).toEqual([])
    expect(scanSecrets('LOG_LEVEL=debug')).toEqual([])
  })

  it('returns the matched range so a caller could redact it', () => {
    const text = 'x sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD1234 y'
    const hit = scanSecrets(text).find((h) => h.category === 'api-key')
    expect(hit).toBeDefined()
    expect(text.slice(hit!.start, hit!.end)).toContain('sk-')
  })

  it('reports multiple distinct secrets in one message', () => {
    const text = 'AKIAIOSFODNN7EXAMPLE and sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD1234'
    const cats = new Set(scanSecrets(text).map((h) => h.category))
    expect(cats.has('aws-key')).toBe(true)
    expect(cats.has('api-key')).toBe(true)
  })
})
