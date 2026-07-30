/**
 * The `<selected-element>` block for point-and-refine (artifact-canvas spec §7).
 *
 * When a user selects an element in the canvas and sends a refinement, the
 * renderer prepends the element's markup to the message *content itself* — it is
 * persisted, shown in the transcript (collapsed to a chip), round-trips on
 * reload, and replays on other models. It is deliberately NOT a hidden prompt
 * augmentation, so main keeps mapping `m.content` straight through unchanged.
 */

const OPEN = '<selected-element>'
const CLOSE = '</selected-element>'

/** Compose message content that carries the selected element ahead of the prompt. */
export function encodeSelection(outerHTML: string, prompt: string): string {
  return `${OPEN}\n${outerHTML.trim()}\n${CLOSE}\n\n${prompt}`
}

export interface DecodedMessage {
  /** The selected element's markup, or null when the message carries none. */
  selection: string | null
  /** The user's prompt with the selection block stripped. */
  body: string
}

/** Split a message into its selection block (if any) and the remaining prompt. */
export function decodeSelection(content: string): DecodedMessage {
  if (!content.startsWith(OPEN)) return { selection: null, body: content }
  const end = content.indexOf(CLOSE)
  if (end === -1) return { selection: null, body: content }
  const selection = content.slice(OPEN.length, end).trim()
  const body = content.slice(end + CLOSE.length).replace(/^\s+/, '')
  return { selection, body }
}
