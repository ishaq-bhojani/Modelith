import { randomUUID } from 'node:crypto'
import { applyContextBudget } from './context-budget.js'
import type { SessionStore } from '../sessions/store.js'
import type { FetchLike, Provider } from '../providers/types.js'
import type { ChatMessage, StreamEnvelope, StreamEvent, Usage } from '../../shared/types.js'

export interface StartInput {
  sessionId: string
  providerId: string
  model: string
  content: string
  /** Optional system prompt (from a Mode), prepended before budgeting. */
  systemPrompt?: string
  /** Optional sampling temperature passed through to the provider. */
  temperature?: number
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
    void this.run(streamId, input, controller)
      .catch(() => {
        // run() is written to catch and report every failure it knows about
        // (a failed append, a misbehaving provider). This is a last-resort
        // net: if something still escapes, the turn must still terminate
        // visibly for the renderer — which otherwise sees a stream that
        // never reaches a terminal event — rather than becoming an
        // unhandled promise rejection.
        this.send(streamId, sessionId, {
          type: 'error', error: { kind: 'unknown', message: 'The turn ended unexpectedly.' },
        })
      })
      .finally(() => {
        // Runs on every path out of run() (success, guarded failure, or the
        // last-resort catch above), so a store failure can never leave the
        // session wedged as permanently "busy".
        this.activeSessions.delete(sessionId)
        this.active.delete(streamId)
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
    try {
      await store.append(sessionId, userMessage)
    } catch {
      // The turn cannot meaningfully proceed if the user's own message never
      // made it to disk — there is nowhere for a provider reply to attach.
      // Report it and stop before ever calling the provider.
      this.send(streamId, sessionId, {
        type: 'error',
        error: { kind: 'unknown', message: 'Your message could not be saved; the turn was not started.' },
      })
      return
    }

    const provider = resolveProvider(input.providerId)
    const apiKey = await readKey(input.providerId)
    if (provider.requiresKey && !apiKey) {
      this.send(streamId, sessionId, {
        type: 'error',
        error: { kind: 'auth', message: 'No API key is configured for this provider.' },
      })
      return
    }

    const history = await store.load(sessionId)
    // A Mode's system prompt is prepended before budgeting. The context budget
    // always retains system messages, and providers already handle the system
    // role, so this needs no special downstream handling.
    const withSystem: ChatMessage[] = input.systemPrompt
      ? [
          { id: randomUUID(), role: 'system', content: input.systemPrompt, createdAt: Date.now() },
          ...history,
        ]
      : history
    const budgeted = applyContextBudget(withSystem, this.deps.maxContextTokens ?? 96_000)
    // budgeted.omittedCount is intentionally unconsumed here — see context-budget.ts.

    let assembled = ''
    let incomplete = false
    let usage: Usage | undefined

    try {
      const request = {
        model: input.model,
        messages: budgeted.messages,
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        config: {
          apiKey: apiKey ?? '',
          fetch: this.deps.fetch ?? globalThis.fetch,
        },
      }
      for await (const event of provider.streamChat(request, controller.signal)) {
        if (controller.signal.aborted) { incomplete = true; break }
        if (event.type === 'text') assembled += event.delta
        if (event.type === 'done') usage = event.usage
        this.send(streamId, sessionId, event)
        // A stream that ends via a provider error (a rate limit or 5xx that
        // arrives mid-stream, after some text has already been yielded) has
        // truncated output exactly as much as an abort does — it must be
        // persisted and marked `incomplete` too, not silently indistinguishable
        // from a reply that finished normally.
        if (event.type === 'error') { incomplete = true; break }
        if (event.type === 'done') break
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
      try {
        await store.append(sessionId, {
          id: randomUUID(),
          role: 'assistant',
          content: assembled,
          createdAt: Date.now(),
          // Provenance: which model/provider produced this reply, and its token
          // usage. Rendered as a badge and used to derive cost. All optional, so
          // messages persisted before this stays valid.
          model: input.model,
          provider: input.providerId,
          ...(usage ? { usage } : {}),
          ...(incomplete ? { incomplete: true } : {}),
        })
      } catch {
        // The user just watched this text stream in; if it can't be
        // persisted they need to know it didn't survive, not just have the
        // stream go quiet.
        this.send(streamId, sessionId, {
          type: 'error',
          error: { kind: 'unknown', message: 'The reply could not be saved.' },
        })
      }
    }
  }
}
