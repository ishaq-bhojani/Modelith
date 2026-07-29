import { randomUUID } from 'node:crypto'
import { applyContextBudget } from './context-budget.js'
import type { SessionStore } from '../sessions/store.js'
import type { FetchLike, Provider } from '../providers/types.js'
import type { ChatMessage, StreamEnvelope, StreamEvent } from '../../shared/types.js'

export interface StartInput {
  sessionId: string
  providerId: string
  model: string
  baseUrl?: string
  content: string
}

export interface StreamEngineDeps {
  emit(envelope: StreamEnvelope): void
  readKey(providerId: string): Promise<string | null>
  store: SessionStore
  resolveProvider(providerId: string): Provider
  fetch?: FetchLike
  maxContextTokens?: number
}

export class StreamEngine {
  private readonly active = new Map<string, AbortController>()
  // Tracks which sessions currently have a turn in flight. SessionStore.append()
  // deliberately does not serialize writes to the *same* session's JSONL file
  // across calls, so this engine must guarantee at most one in-flight turn per
  // session at a time — otherwise two concurrent turns could interleave writes
  // to the same file. Turns against different sessions are unaffected.
  private readonly activeSessions = new Set<string>()

  constructor(private readonly deps: StreamEngineDeps) {}

  abort(streamId: string): void {
    this.active.get(streamId)?.abort()
    this.active.delete(streamId)
  }

  async start(input: StartInput): Promise<{ streamId: string }> {
    const streamId = randomUUID()
    const { sessionId } = input

    // Checked and marked synchronously (no `await` above this point) so that
    // two start() calls issued back-to-back for the same session — even
    // without the caller awaiting between them — cannot both observe the
    // session as free.
    if (this.activeSessions.has(sessionId)) {
      this.send(streamId, sessionId, {
        type: 'error',
        error: { kind: 'busy', message: 'A turn is already in progress for this session.' },
      })
      return { streamId }
    }
    this.activeSessions.add(sessionId)

    const controller = new AbortController()
    this.active.set(streamId, controller)
    void this.run(streamId, input, controller).finally(() => {
      this.activeSessions.delete(sessionId)
    })
    return { streamId }
  }

  private send(streamId: string, sessionId: string, event: StreamEvent): void {
    this.deps.emit({ streamId, sessionId, event })
  }

  private async run(streamId: string, input: StartInput, controller: AbortController): Promise<void> {
    const { store, readKey, resolveProvider } = this.deps
    const { sessionId } = input

    const userMessage: ChatMessage = {
      id: randomUUID(), role: 'user', content: input.content, createdAt: Date.now(),
    }
    await store.append(sessionId, userMessage)

    const provider = resolveProvider(input.providerId)
    const apiKey = await readKey(input.providerId)
    if (provider.requiresKey && !apiKey) {
      this.send(streamId, sessionId, {
        type: 'error',
        error: { kind: 'auth', message: 'No API key is configured for this provider.' },
      })
      this.active.delete(streamId)
      return
    }

    const history = await store.load(sessionId)
    const budgeted = applyContextBudget(history, this.deps.maxContextTokens ?? 96_000)
    // budgeted.omittedCount is intentionally unconsumed here — see context-budget.ts.

    let assembled = ''
    let incomplete = false

    try {
      const request = {
        model: input.model,
        messages: budgeted.messages,
        config: {
          apiKey: apiKey ?? '',
          ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
          fetch: this.deps.fetch ?? globalThis.fetch,
        },
      }
      for await (const event of provider.streamChat(request, controller.signal)) {
        if (controller.signal.aborted) { incomplete = true; break }
        if (event.type === 'text') assembled += event.delta
        this.send(streamId, sessionId, event)
        if (event.type === 'done' || event.type === 'error') break
      }
    } catch {
      // provider.streamChat contractually never throws (it yields an `error`
      // event instead), but this guards against a misbehaving provider so a
      // thrown exception can never silently discard partial output. A crash
      // that happens to coincide with a user-initiated abort is treated as
      // an abort (see note below) rather than reported as an error.
      incomplete = true
      if (!controller.signal.aborted) {
        this.send(streamId, sessionId, {
          type: 'error', error: { kind: 'unknown', message: 'The turn ended unexpectedly.' },
        })
      }
    }

    if (controller.signal.aborted) incomplete = true

    if (assembled.length > 0 || incomplete) {
      await store.append(sessionId, {
        id: randomUUID(),
        role: 'assistant',
        content: assembled,
        createdAt: Date.now(),
        ...(incomplete ? { incomplete: true } : {}),
      })
    }
    this.active.delete(streamId)
  }
}
