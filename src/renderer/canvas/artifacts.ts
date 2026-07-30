import type { ChatMessage } from '@shared/types'
import { CANVAS_LANGS, scanBlocks } from './fence-scanner.js'

export type ArtifactLang = 'html' | 'svg' | 'mermaid'

export interface Artifact {
  /** One artifact per language per conversation; the id is the language. */
  id: ArtifactLang
  lang: ArtifactLang
  /** Each routed block's content, oldest first. */
  versions: string[]
  /** Index into `versions`; defaults to the newest. */
  currentIndex: number
}

/** `mmd` is an alias for mermaid; everything else in CANVAS_LANGS is its own id. */
function normalize(lang: string): ArtifactLang {
  return (lang === 'mmd' ? 'mermaid' : lang) as ArtifactLang
}

/**
 * Derives the canvas artifacts from the conversation — a pure function of the
 * messages plus the in-flight streaming text (see the artifact-canvas spec §5).
 *
 * Rules:
 *  - Only assistant messages contribute blocks (a user pasting HTML is not an
 *    artifact).
 *  - Blocks are collected in conversation order, then document order within a
 *    message; the streaming reply is considered last.
 *  - The first block of a language creates its artifact; each later block of the
 *    same language appends a version. `currentIndex` is the newest.
 *  - Because this recomputes from scratch each token, the growing streaming
 *    block is always exactly one (provisional) version — never one per token.
 */
export function deriveArtifacts(messages: ChatMessage[], streamingText: string): Artifact[] {
  const byLang = new Map<ArtifactLang, Artifact>()
  const order: ArtifactLang[] = []

  const consider = (content: string) => {
    for (const block of scanBlocks(content)) {
      if (!CANVAS_LANGS.has(block.lang)) continue
      const lang = normalize(block.lang)
      let artifact = byLang.get(lang)
      if (!artifact) {
        artifact = { id: lang, lang, versions: [], currentIndex: 0 }
        byLang.set(lang, artifact)
        order.push(lang)
      }
      artifact.versions.push(block.content)
    }
  }

  for (const message of messages) {
    if (message.role === 'assistant') consider(message.content)
  }
  if (streamingText) consider(streamingText)

  for (const artifact of byLang.values()) {
    artifact.currentIndex = Math.max(0, artifact.versions.length - 1)
  }

  return order.map((lang) => byLang.get(lang)!)
}
