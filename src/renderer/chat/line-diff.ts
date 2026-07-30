/**
 * A minimal line-level diff (LCS) for the diff-approval gate (agentic-edits
 * spec §4). Pure and dependency-free; good enough to show what a proposed write
 * changes. The applied bytes are always the exact proposed content — this only
 * drives the red/green display.
 */
export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string }

export function lineDiff(previous: string | null, proposed: string): DiffLine[] {
  const a = (previous ?? '').length === 0 && previous !== '' ? [] : (previous ?? '').split('\n')
  const b = proposed.split('\n')
  // If there was no prior file, everything is an addition.
  if (previous === null) return b.map((text) => ({ kind: 'add' as const, text }))

  const m = a.length
  const n = b.length
  // LCS length table.
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ kind: 'same', text: a[i]! }); i++; j++ }
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) { out.push({ kind: 'del', text: a[i]! }); i++ }
    else { out.push({ kind: 'add', text: b[j]! }); j++ }
  }
  while (i < m) { out.push({ kind: 'del', text: a[i]! }); i++ }
  while (j < n) { out.push({ kind: 'add', text: b[j]! }); j++ }
  return out
}
