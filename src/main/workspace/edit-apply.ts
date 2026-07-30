/**
 * Applies a targeted search/replace to file content — the pure core of the
 * `apply_edit` tool (agentic-edits spec §2). Deliberately literal (no regex)
 * and deliberately strict: a search that is missing or that matches more than
 * once is refused rather than guessed, so an edit never silently lands in the
 * wrong place. The caller turns a success into a diff to show at the gate.
 */

export type EditResult =
  | { ok: true; content: string }
  | { ok: false; error: 'empty-search' | 'not-found' | 'ambiguous' }

export function applyEdit(content: string, search: string, replace: string): EditResult {
  if (search === '') return { ok: false, error: 'empty-search' }

  const first = content.indexOf(search)
  if (first === -1) return { ok: false, error: 'not-found' }
  if (content.indexOf(search, first + search.length) !== -1) {
    return { ok: false, error: 'ambiguous' }
  }

  // Literal splice — replacement text is inserted verbatim (no $-group or
  // backslash interpretation that String.prototype.replace would apply).
  const next = content.slice(0, first) + replace + content.slice(first + search.length)
  return { ok: true, content: next }
}
