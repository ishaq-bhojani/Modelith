export type SecretCategory = 'api-key' | 'aws-key' | 'private-key' | 'env-secret'

export interface SecretMatch {
  category: SecretCategory
  /** Character offset of the match start, inclusive. */
  start: number
  /** Character offset of the match end, exclusive. */
  end: number
}

/**
 * A conservative outbound-secret detector. It runs in the renderer, at compose
 * time, so the user is warned before a credential leaves the machine — a guard
 * against the common accident of pasting a key into a prompt, NOT a security
 * boundary (that remains: keys live in main, never in the renderer).
 *
 * Tuned to favour precision over recall. A false positive nags the user on a
 * benign prompt, which erodes trust in the warning, so each pattern is specific
 * enough that ordinary prose and code do not trip it. Missing an exotic secret
 * format is acceptable; crying wolf is not.
 */
const PATTERNS: { category: SecretCategory; re: RegExp }[] = [
  // OpenAI / Anthropic / generic `sk-`-prefixed keys: sk- followed by a long
  // run of key characters. The length floor keeps it off ordinary hyphenated
  // words.
  { category: 'api-key', re: /\bsk-[A-Za-z0-9_-]{24,}\b/g },
  // AWS access key id: the fixed AKIA/ASIA prefix plus 16 uppercase alnum.
  { category: 'aws-key', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  // PEM private key header.
  { category: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  // A .env-style assignment whose NAME looks secret-bearing and whose VALUE is
  // long enough to plausibly be one. Requires both so `NODE_ENV=production`
  // (secret-ish value length but innocuous name) and `LOG_LEVEL=debug` (short
  // value) are left alone.
  {
    category: 'env-secret',
    re: /\b[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY)[A-Z0-9_]*\s*[=:]\s*\S{12,}/gi,
  },
]

export function scanSecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = []
  for (const { category, re } of PATTERNS) {
    // Each pattern carries the global flag; construct a fresh lastIndex per scan
    // by resetting it, so scanSecrets is safe to call repeatedly.
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      matches.push({ category, start: m.index, end: m.index + m[0].length })
      // Guard against a zero-length match looping forever (none of the patterns
      // can match empty, but this keeps the loop provably terminating).
      if (m.index === re.lastIndex) re.lastIndex++
    }
  }
  return matches.sort((a, b) => a.start - b.start)
}
