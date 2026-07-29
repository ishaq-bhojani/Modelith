export interface SseRecord {
  event?: string
  data: string
}

export interface SseParseResult {
  events: SseRecord[]
  residual: string
}

/**
 * Incremental, pure SSE parser. Feed each chunk with the residual from the
 * previous call. Records split across arbitrary chunk boundaries are joined.
 */
export function parseSse(chunk: string, residual: string): SseParseResult {
  const buffer = (residual + chunk).replace(/\r\n/g, '\n')
  const blocks = buffer.split('\n\n')
  const trailing = blocks.pop() ?? ''

  const events: SseRecord[] = []
  for (const block of blocks) {
    const dataLines: string[] = []
    let eventName: string | undefined

    for (const line of block.split('\n')) {
      if (line === '' || line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      const rawValue = colon === -1 ? '' : line.slice(colon + 1)
      const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue

      if (field === 'data') dataLines.push(value)
      else if (field === 'event') eventName = value
    }

    if (dataLines.length > 0) {
      events.push(eventName === undefined
        ? { data: dataLines.join('\n') }
        : { event: eventName, data: dataLines.join('\n') })
    }
  }

  return { events, residual: trailing }
}
