import type { Attachment } from './types.js'

/** Image types the app accepts and every vision provider understands. */
export const ALLOWED_IMAGE_MIME = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
])

/** Per-image ceiling on the decoded byte size (spec §B.3). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** Decoded byte length of a base64 string, without allocating the buffer. */
export function base64Bytes(data: string): number {
  const len = data.length
  if (len === 0) return 0
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return Math.floor((len * 3) / 4) - padding
}

export type AttachmentCheck = { ok: true } | { ok: false; error: string }

/** Validate one attachment's type and size before it is attached or sent. */
export function validateAttachment(att: Attachment): AttachmentCheck {
  if (att.type !== 'image') return { ok: false, error: 'Only image attachments are supported.' }
  if (!ALLOWED_IMAGE_MIME.has(att.mimeType)) {
    return { ok: false, error: `${att.mimeType || 'This file type'} is not a supported image.` }
  }
  if (att.data.length === 0) return { ok: false, error: 'The image is empty.' }
  if (base64Bytes(att.data) > MAX_IMAGE_BYTES) {
    return { ok: false, error: 'Image is larger than 5 MB.' }
  }
  return { ok: true }
}
