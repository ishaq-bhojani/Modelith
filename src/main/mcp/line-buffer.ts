/**
 * Splits a stream of stdout chunks into newline-delimited messages — the MCP
 * stdio framing (agentic-edits neighbour: mcp-client spec §1). Pure so the
 * framing can be tested without spawning a process: feed chunks, get complete
 * lines out and the unterminated remainder to carry forward.
 */
export function splitLines(carry: string, chunk: string): { lines: string[]; carry: string } {
  const combined = carry + chunk
  const parts = combined.split('\n')
  const rest = parts.pop() ?? '' // last element is the (possibly empty) remainder
  return { lines: parts.filter((l) => l.length > 0), carry: rest }
}
