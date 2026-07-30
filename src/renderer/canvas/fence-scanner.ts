export interface Block {
  /** Lowercased, trimmed language tag from the fence info string ('' if none). */
  lang: string
  /** The block's body, exclusive of the fence lines. */
  content: string
  /** False while the block is still open (streaming) — its content grows. */
  complete: boolean
}

/** Languages that route to the live canvas rather than an ordinary code block. */
export const CANVAS_LANGS = new Set(['html', 'svg', 'mermaid', 'mmd'])

const OPEN = /^(`{3,}|~{3,})\s*([^\s`~]*)/

/**
 * Extracts fenced code blocks from a (possibly partial) markdown stream.
 *
 * A pure function over the whole source rather than a chunk-and-residual pair:
 * artifact derivation re-runs it on every streamed token, and running over the
 * accumulated text is both simpler and far easier to test than maintaining
 * incremental state. Unterminated blocks are returned with `complete: false` and
 * their content so far, because progressive rendering of an in-flight artifact
 * is the whole point.
 *
 * Fence matching follows CommonMark closely enough for real model output: a
 * fence is a run of 3+ backticks or tildes; it closes only on a later line of
 * the same character, at least as long — so a longer outer fence can contain
 * shorter inner fences (nested code samples).
 */
export function scanBlocks(source: string): Block[] {
  const lines = source.split('\n')
  const blocks: Block[] = []

  let open: { char: string; len: number; lang: string; body: string[] } | null = null

  for (const line of lines) {
    if (open) {
      // A closing fence: same char, length >= the opening run, nothing but the
      // fence (and optional trailing whitespace) on the line.
      const closeRe = new RegExp(`^${open.char === '`' ? '`' : '~'}{${open.len},}\\s*$`)
      if (closeRe.test(line.trimEnd()) && line.trimStart()[0] === open.char) {
        blocks.push({ lang: open.lang, content: open.body.join('\n'), complete: true })
        open = null
      } else {
        open.body.push(line)
      }
      continue
    }

    const m = OPEN.exec(line)
    if (m && m[1]) {
      open = { char: m[1][0]!, len: m[1].length, lang: (m[2] ?? '').trim().toLowerCase(), body: [] }
    }
  }

  // A block still open at end-of-source is streaming; surface it incomplete.
  if (open) blocks.push({ lang: open.lang, content: open.body.join('\n'), complete: false })

  return blocks
}
