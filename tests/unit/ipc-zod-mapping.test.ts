import { describe, it, expect } from 'vitest'
import { z, ZodError } from 'zod'
import { withZodMapping } from '../../src/main/ipc/handlers.js'

describe('withZodMapping', () => {
  const Schema = z.object({ id: z.string().min(1) })

  it('passes through a successful call untouched', async () => {
    const wrapped = withZodMapping((raw: unknown) => Schema.parse(raw).id)
    await expect(wrapped({ id: 'abc' })).resolves.toBe('abc')
  })

  it('maps a ZodError into a clean, non-raw message instead of letting it reach the renderer verbatim', async () => {
    const wrapped = withZodMapping((raw: unknown) => Schema.parse(raw).id)
    await expect(wrapped({})).rejects.toThrow(/malformed/i)
    // The spec's error taxonomy forbids a raw validation dump reaching a chat
    // bubble — assert the actual ZodError shape ('invalid_type', 'issues',
    // etc.) never leaks into the thrown message.
    try {
      await wrapped({})
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect(err).not.toBeInstanceOf(ZodError)
      const message = (err as Error).message
      expect(message).not.toMatch(/invalid_type/)
      expect(message).not.toMatch(/ZodError/)
    }
  })

  it('lets a non-Zod error pass through unchanged', async () => {
    const wrapped = withZodMapping(() => { throw new Error('disk is full') })
    await expect(wrapped()).rejects.toThrow('disk is full')
  })
})
