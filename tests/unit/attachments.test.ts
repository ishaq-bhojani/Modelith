import { describe, it, expect } from 'vitest'
import { validateAttachment, base64Bytes, MAX_IMAGE_BYTES } from '../../src/shared/attachments.js'
import type { Attachment } from '../../src/shared/types.js'

const img = (over: Partial<Attachment> = {}): Attachment => ({
  type: 'image', mimeType: 'image/png', data: 'aGVsbG8=', ...over,
})

describe('base64Bytes', () => {
  it('computes decoded length accounting for padding', () => {
    expect(base64Bytes('')).toBe(0)
    expect(base64Bytes('aGVsbG8=')).toBe(5)   // "hello"
    expect(base64Bytes('aGVsbG9v')).toBe(6)   // "helloo", no padding
    expect(base64Bytes('aGk=')).toBe(2)       // "hi"
  })
})

describe('validateAttachment', () => {
  it('accepts a small supported image', () => {
    expect(validateAttachment(img())).toEqual({ ok: true })
  })

  it('rejects an unsupported mime type', () => {
    expect(validateAttachment(img({ mimeType: 'image/tiff' })).ok).toBe(false)
    expect(validateAttachment(img({ mimeType: 'application/pdf' })).ok).toBe(false)
  })

  it('rejects an empty image', () => {
    expect(validateAttachment(img({ data: '' })).ok).toBe(false)
  })

  it('rejects an image over the size cap', () => {
    // A base64 string whose decoded size exceeds the cap.
    const big = 'A'.repeat(Math.ceil((MAX_IMAGE_BYTES + 1) * 4 / 3))
    expect(validateAttachment(img({ data: big })).ok).toBe(false)
  })

  it('rejects a non-image attachment type', () => {
    expect(validateAttachment({ ...img(), type: 'video' as unknown as 'image' }).ok).toBe(false)
  })
})
