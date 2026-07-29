import { describe, it, expect } from 'vitest'
import { CHANNELS, AppInfoSchema } from '@shared/ipc'

describe('ipc contract', () => {
  it('exposes no channel that could read a secret', () => {
    const names = Object.values(CHANNELS)
    expect(names.some((n) => /get.*key|read.*key|key.*get/i.test(n))).toBe(false)
  })

  it('every channel name is unique', () => {
    const names = Object.values(CHANNELS)
    expect(new Set(names).size).toBe(names.length)
  })

  it('validates app info payloads', () => {
    expect(AppInfoSchema.parse({ version: '0.0.1', platform: 'win32' }).version).toBe('0.0.1')
    expect(() => AppInfoSchema.parse({ version: 1 })).toThrow()
  })
})
