import { randomUUID } from 'node:crypto'
import { applyContextBudget } from './context-budget.js'
import { TOOL_SPECS, TERMINAL_TOOL_SPECS, executeTool, type ApprovalDecision, type PendingEdit } from './tools.js'
import { runCommand } from '../terminal/runner.js'
import type { SessionStore } from '../sessions/store.js'
import type { FetchLike, Provider } from '../providers/types.js'
import type { Workspace } from '../workspace/service.js'
import type { McpManager } from '../mcp/manager.js'
import type { Attachment, ChatMessage, ProviderError, StreamEnvelope, StreamEvent, ToolCall, Usage } from '../../shared/types.js'

export interface Fallback {
  providerId: string
  model: string
}

export interface StartInput {
  sessionId: string
  providerId: string
  model: string
  content: string
  /** Image attachments sent with this turn (spec §B). */
  attachments?: Attachment[]
  /** When true (and a workspace is open), the model may call edit tools behind
   *  the approval gate (agentic-edits spec §3). Off = plain chat, no tools. */
  agent?: boolean
  /** Optional system prompt (from a Mode), prepended before budgeting. */
  systemPrompt?: string
  /** Optional sampling temperature passed through to the provider. */
  temperature?: number
  /** Ordered failover targets tried if the primary fails before any output. */
  fallbacks?: Fallback[]
}

/** Input for a Model Race turn (model-race spec §2). */
export interface RaceInput {
  sessionId: string
  content: string
  systemPrompt?: string
  temperature?: number
  entries: Fallback[]
}

/** Error kinds worth retrying on another provider (transient, not the user's fault). */
const RETRYABLE = new Set(['rate_limit', 'provider_5xx', 'network'])

export interface StreamEngineDeps {
  emit(envelope: StreamEnvelope): void
  readKey(providerId: string): Promise<string | null>
  store: SessionStore
  resolveProvider(providerId: string): Provider
  fetch?: FetchLike
  maxContextTokens?: number
  /** Present when agentic edits are available; absent = tools disabled. */
  workspace?: Workspace
  /** Present when MCP servers may contribute tools (mcp-client spec §3). */
  mcp?: McpManager
}

/** Hard cap on tool round-trips per user turn (agentic-edits spec §3). */
const MAX_TOOL_ITERATIONS = 12

export class StreamEngine {
  private readonly active = new Map<string, AbortController>()
  // Tracks which sessions currently have a turn in flight. SessionStore.append()
  // deliberately does not serialize writes to the *same* session's JSONL file
  // across calls, so this engine must guarantee at most one in-flight turn per
  // session at a time — otherwise two concurrent turns could interleave writes
  // to the same file. Turns against different sessions are unaffected.
  private readonly activeSessions = new Set<string>()
  // Writes awaiting a user decision at the diff gate, keyed by tool-call id.
  private readonly pendingApprovals = new Map<string, (decision: ApprovalDecision) => void>()

  constructor(private readonly deps: StreamEngineDeps) {}

  // In-flight races: raceId → the columns' accumulating state and the session
  // it belongs to (model-race spec §2). The session stays busy until a winner
  // is chosen or the race is discarded/aborted.
  private readonly races = new Map<string, {
    sessionId: string
    columns: Map<string, { providerId: string; model: string; assembled: string; usage?: Usage }>
  }>()

  abort(streamId: string): void {
    this.active.get(streamId)?.abort()
    this.active.delete(streamId)
    // Aborting a race also discards it and frees the session (no winner).
    const race = this.races.get(streamId)
    if (race) { this.activeSessions.delete(race.sessionId); this.races.delete(streamId) }
  }

  /** Deliver a diff-gate decision from the renderer (agentic-edits spec §4). */
  resolveApproval(callId: string, decision: ApprovalDecision): void {
    const resolve = this.pendingApprovals.get(callId)
    if (resolve) { this.pendingApprovals.delete(callId); resolve(decision) }
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

  private sendCol(raceId: string, sessionId: string, columnId: string, event: StreamEvent): void {
    this.deps.emit({ streamId: raceId, sessionId, event, columnId })
  }

  /**
   * Start a Model Race (model-race spec §2): append the user message once, then
   * stream N models concurrently into columns that write nothing to the store.
   * The session is reserved for the whole race and released only when a winner
   * is chosen (chooseRaceWinner) or the race is aborted/discarded (abort).
   */
  async startRace(input: RaceInput): Promise<{ raceId: string }> {
    const raceId = randomUUID()
    const { sessionId } = input
    if (this.activeSessions.has(sessionId)) {
      this.send(raceId, sessionId, { type: 'error', error: { kind: 'busy', message: 'A turn is already in progress for this session.' } })
      return { raceId }
    }
    this.activeSessions.add(sessionId)
    const controller = new AbortController()
    this.active.set(raceId, controller)
    this.races.set(raceId, { sessionId, columns: new Map() })
    void this.runRace(raceId, input, controller).catch(() => {
      this.send(raceId, sessionId, { type: 'error', error: { kind: 'unknown', message: 'The race ended unexpectedly.' } })
      // Leave the session reserved so the user can still discard cleanly via abort.
    })
    return { raceId }
  }

  private async runRace(raceId: string, input: RaceInput, controller: AbortController): Promise<void> {
    const { store } = this.deps
    const userMessage: ChatMessage = { id: randomUUID(), role: 'user', content: input.content, createdAt: Date.now() }
    try {
      await store.append(input.sessionId, userMessage)
    } catch {
      this.send(raceId, input.sessionId, { type: 'error', error: { kind: 'unknown', message: 'Your message could not be saved; the race was not started.' } })
      this.activeSessions.delete(input.sessionId); this.races.delete(raceId)
      return
    }
    const history = await store.load(input.sessionId)
    const withSystem: ChatMessage[] = input.systemPrompt
      ? [{ id: randomUUID(), role: 'system', content: input.systemPrompt, createdAt: Date.now() }, ...history]
      : history
    const budgeted = applyContextBudget(withSystem, this.deps.maxContextTokens ?? 96_000)

    await Promise.all(input.entries.map((entry, i) =>
      this.runColumn(raceId, input, `col-${i}`, entry, budgeted.messages, controller)))
    // Columns are done; the session stays busy until the user picks or discards.
  }

  private async runColumn(
    raceId: string,
    input: RaceInput,
    columnId: string,
    entry: Fallback,
    messages: ChatMessage[],
    controller: AbortController,
  ): Promise<void> {
    const race = this.races.get(raceId)
    if (!race) return
    race.columns.set(columnId, { providerId: entry.providerId, model: entry.model, assembled: '' })
    const col = race.columns.get(columnId)!

    const provider = this.deps.resolveProvider(entry.providerId)
    const apiKey = await this.deps.readKey(entry.providerId)
    if (provider.requiresKey && !apiKey) {
      this.sendCol(raceId, input.sessionId, columnId, { type: 'error', error: { kind: 'auth', message: 'No API key for this provider.' } })
      return
    }
    try {
      const request = {
        model: entry.model,
        messages,
        config: { apiKey: apiKey ?? '', fetch: this.deps.fetch ?? globalThis.fetch },
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      }
      for await (const event of provider.streamChat(request, controller.signal)) {
        if (controller.signal.aborted) break
        if (event.type === 'text') { col.assembled += event.delta; this.sendCol(raceId, input.sessionId, columnId, event) }
        else if (event.type === 'reasoning') { this.sendCol(raceId, input.sessionId, columnId, event) }
        else if (event.type === 'done') { col.usage = event.usage; this.sendCol(raceId, input.sessionId, columnId, { type: 'done', model: entry.model, provider: entry.providerId, ...(event.usage ? { usage: event.usage } : {}) }); break }
        else if (event.type === 'error') { this.sendCol(raceId, input.sessionId, columnId, event); break }
      }
    } catch {
      if (!controller.signal.aborted) this.sendCol(raceId, input.sessionId, columnId, { type: 'error', error: { kind: 'unknown', message: 'This column ended unexpectedly.' } })
    }
  }

  /** Persist the chosen column as the turn's reply and release the session. */
  async chooseRaceWinner(raceId: string, columnId: string): Promise<void> {
    const race = this.races.get(raceId)
    if (!race) return
    const col = race.columns.get(columnId)
    this.active.get(raceId)?.abort() // stop any still-streaming losers
    if (col) {
      try {
        await this.deps.store.append(race.sessionId, {
          id: randomUUID(), role: 'assistant', content: col.assembled, createdAt: Date.now(),
          model: col.model, provider: col.providerId, ...(col.usage ? { usage: col.usage } : {}),
        })
      } catch {
        this.send(raceId, race.sessionId, { type: 'error', error: { kind: 'unknown', message: 'The chosen reply could not be saved.' } })
      }
    }
    this.activeSessions.delete(race.sessionId)
    this.races.delete(raceId)
    this.active.delete(raceId)
  }

  private async run(streamId: string, input: StartInput, controller: AbortController): Promise<void> {
    const { store, readKey, resolveProvider } = this.deps
    const { sessionId } = input

    const userMessage: ChatMessage = {
      id: randomUUID(), role: 'user', content: input.content, createdAt: Date.now(),
      ...(input.attachments && input.attachments.length > 0 ? { attachments: input.attachments } : {}),
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

    // Authenticate the PRIMARY provider up front: a missing key here is the
    // user's own configuration error and must surface as `auth`, not silently
    // fall through to a fallback (which would hide the real problem).
    const primary = resolveProvider(input.providerId)
    const primaryKey = await readKey(input.providerId)
    if (primary.requiresKey && !primaryKey) {
      this.send(streamId, sessionId, {
        type: 'error',
        error: { kind: 'auth', message: 'No API key is configured for this provider.' },
      })
      return
    }

    // Agentic edits are available only when explicitly requested AND a
    // workspace is wired; otherwise this stays a plain chat with no tools.
    const agent = input.agent === true && this.deps.workspace !== undefined
    // Terminal/git tools need a concrete root to run in; resolve it once.
    const root = agent ? await this.deps.workspace!.current() : null
    // In agent mode, offer edit tools, terminal/git tools (when a root exists),
    // plus any connected MCP server tools.
    const mcpTools = agent ? (this.deps.mcp?.toolSpecs() ?? []) : []
    const terminalTools = agent && root ? TERMINAL_TOOL_SPECS : []
    const tools = agent ? [...TOOL_SPECS, ...terminalTools, ...mcpTools] : undefined
    const turnId = streamId // one id for the whole user turn (checkpoints/revert)

    // The primary followed by any configured fallbacks. Failover only happens on
    // the FIRST streamed turn (before any tool round-trip commits us to a
    // provider) and *within this one user turn* — the session stays busy
    // throughout, so the one-turn-per-session invariant is never violated.
    const attempts: Fallback[] = [
      { providerId: input.providerId, model: input.model },
      ...(input.fallbacks ?? []),
    ]

    // The agentic tool loop: stream a turn; if the model requested no tools,
    // finish; otherwise run the tools (gating writes) and stream again with the
    // results appended, bounded by MAX_TOOL_ITERATIONS.
    for (let iteration = 0; ; iteration++) {
      if (controller.signal.aborted) break

      const history = await store.load(sessionId)
      const withSystem: ChatMessage[] = input.systemPrompt
        ? [{ id: randomUUID(), role: 'system', content: input.systemPrompt, createdAt: Date.now() }, ...history]
        : history
      const budgeted = applyContextBudget(withSystem, this.deps.maxContextTokens ?? 96_000)

      const turn = await this.streamTurn(streamId, sessionId, budgeted.messages, attempts, controller, {
        allowFailover: iteration === 0,
        primaryKey,
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        ...(tools ? { tools } : {}),
      })

      const aborted = controller.signal.aborted
      const incomplete = turn.incomplete || aborted
      // Persist the assistant message (text + any tool calls it requested).
      if (turn.assembled.length > 0 || turn.toolCalls.length > 0 || incomplete) {
        try {
          await store.append(sessionId, {
            id: randomUUID(),
            role: 'assistant',
            content: turn.assembled,
            createdAt: Date.now(),
            model: turn.finalModel,
            provider: turn.finalProviderId,
            turnId,
            ...(turn.toolCalls.length > 0 ? { toolCalls: turn.toolCalls } : {}),
            ...(turn.usage ? { usage: turn.usage } : {}),
            ...(incomplete ? { incomplete: true } : {}),
          })
        } catch {
          this.send(streamId, sessionId, { type: 'error', error: { kind: 'unknown', message: 'The reply could not be saved.' } })
          return
        }
      }

      if (turn.error) { this.send(streamId, sessionId, { type: 'error', error: turn.error }); return }
      if (aborted) return

      // No tool calls → the turn is complete.
      if (turn.toolCalls.length === 0) {
        this.send(streamId, sessionId, {
          type: 'done', model: turn.finalModel, provider: turn.finalProviderId, ...(turn.usage ? { usage: turn.usage } : {}),
        })
        return
      }

      if (iteration >= MAX_TOOL_ITERATIONS) {
        this.send(streamId, sessionId, { type: 'notice', text: 'Tool-call limit reached; stopping.' })
        this.send(streamId, sessionId, { type: 'done', model: turn.finalModel, provider: turn.finalProviderId })
        return
      }

      // Execute each requested tool; reads run immediately, writes gate.
      for (const call of turn.toolCalls) {
        if (controller.signal.aborted) return
        const outcome = await executeTool(call.name, call.arguments, call.id, {
          workspace: this.deps.workspace!,
          turnId,
          requestApproval: (edit) => this.requestApproval(streamId, sessionId, edit, controller),
          requestConfirm: (confirm) => this.requestConfirm(streamId, sessionId, confirm, controller),
          ...(this.deps.mcp ? { mcpCall: (n, a) => this.deps.mcp!.call(n, a) } : {}),
          ...(root ? { runShell: async (cmd: string) => {
            const r = await runCommand(cmd, { cwd: root, signal: controller.signal })
            return { output: r.output, exitCode: r.exitCode }
          } } : {}),
        })
        this.send(streamId, sessionId, { type: 'tool_result', callId: call.id, name: call.name, ok: !outcome.isError, summary: outcome.result.slice(0, 200) })
        try {
          await store.append(sessionId, {
            id: randomUUID(), role: 'tool', content: outcome.result, toolCallId: call.id, createdAt: Date.now(),
          })
        } catch {
          this.send(streamId, sessionId, { type: 'error', error: { kind: 'unknown', message: 'A tool result could not be saved.' } })
          return
        }
      }
      // Loop: the next streamTurn includes the tool results as context.
    }
  }

  /**
   * Emit a pending write to the renderer and await the user's decision. If the
   * turn aborts while waiting, resolves as a reject so the loop unwinds cleanly.
   */
  private requestApproval(
    streamId: string,
    sessionId: string,
    edit: PendingEdit,
    controller: AbortController,
  ): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      if (controller.signal.aborted) { resolve({ action: 'reject' }); return }
      const settle = (decision: ApprovalDecision) => {
        controller.signal.removeEventListener('abort', onAbort)
        resolve(decision)
      }
      const onAbort = () => { this.pendingApprovals.delete(edit.callId); settle({ action: 'reject' }) }
      controller.signal.addEventListener('abort', onAbort, { once: true })
      this.pendingApprovals.set(edit.callId, settle)
      this.send(streamId, sessionId, {
        type: 'tool_pending', callId: edit.callId, tool: edit.tool, relPath: edit.relPath, previous: edit.previous, proposed: edit.proposed,
      })
    })
  }

  /** Emit a generic tool-call confirmation and await the user's yes/no. */
  private requestConfirm(
    streamId: string,
    sessionId: string,
    confirm: { callId: string; name: string; argsJson: string },
    controller: AbortController,
  ): Promise<'accept' | 'reject'> {
    return new Promise<'accept' | 'reject'>((resolve) => {
      if (controller.signal.aborted) { resolve('reject'); return }
      const settle = (decision: ApprovalDecision) => {
        controller.signal.removeEventListener('abort', onAbort)
        resolve(decision.action === 'reject' ? 'reject' : 'accept')
      }
      const onAbort = () => { this.pendingApprovals.delete(confirm.callId); settle({ action: 'reject' }) }
      controller.signal.addEventListener('abort', onAbort, { once: true })
      this.pendingApprovals.set(confirm.callId, settle)
      this.send(streamId, sessionId, { type: 'tool_confirm', callId: confirm.callId, name: confirm.name, argsJson: confirm.argsJson })
    })
  }

  /**
   * Stream a single provider turn: sends text/reasoning/notice to the renderer,
   * emits tool-call activity, and returns the assembled text plus any tool calls
   * the model requested. Failover (across configured fallbacks) applies only
   * when `allowFailover` is set and nothing has streamed yet.
   */
  private async streamTurn(
    streamId: string,
    sessionId: string,
    messages: ChatMessage[],
    attempts: Fallback[],
    controller: AbortController,
    opts: { allowFailover: boolean; primaryKey: string | null; temperature?: number; tools?: typeof TOOL_SPECS },
  ): Promise<{
    assembled: string
    toolCalls: ToolCall[]
    usage?: Usage
    incomplete: boolean
    error?: ProviderError
    finalProviderId: string
    finalModel: string
  }> {
    const { resolveProvider, readKey } = this.deps
    let assembled = ''
    let incomplete = false
    let usage: Usage | undefined
    let finalProviderId = attempts[0]!.providerId
    let finalModel = attempts[0]!.model
    let toolCalls: ToolCall[] = []

    const maxAttempts = opts.allowFailover ? attempts.length : 1
    for (let i = 0; i < maxAttempts; i++) {
      const attempt = attempts[i]
      if (!attempt || controller.signal.aborted) break

      const provider = resolveProvider(attempt.providerId)
      const apiKey = i === 0 ? opts.primaryKey : await readKey(attempt.providerId)
      if (provider.requiresKey && !apiKey) continue

      finalProviderId = attempt.providerId
      finalModel = attempt.model
      let attemptError: ProviderError | undefined
      const calls: ToolCall[] = []

      try {
        const request = {
          model: attempt.model,
          messages,
          config: { apiKey: apiKey ?? '', fetch: this.deps.fetch ?? globalThis.fetch },
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
          ...(opts.tools ? { tools: opts.tools } : {}),
        }
        for await (const event of provider.streamChat(request, controller.signal)) {
          if (controller.signal.aborted) { incomplete = true; break }
          if (event.type === 'text') { assembled += event.delta; this.send(streamId, sessionId, event) }
          else if (event.type === 'reasoning') { this.send(streamId, sessionId, event) }
          else if (event.type === 'tool_call') { calls.push({ id: event.id, name: event.name, arguments: event.arguments }); this.send(streamId, sessionId, event) }
          else if (event.type === 'done') { usage = event.usage; break }
          else if (event.type === 'error') { attemptError = event.error; break }
        }
      } catch {
        if (!controller.signal.aborted) attemptError = { kind: 'unknown', message: 'The turn ended unexpectedly.' }
        incomplete = true
      }

      if (controller.signal.aborted) { incomplete = true; break }

      const canFailOver =
        attemptError !== undefined && RETRYABLE.has(attemptError.kind) &&
        assembled === '' && calls.length === 0 && i < maxAttempts - 1
      if (canFailOver) {
        const next = attempts[i + 1]
        this.send(streamId, sessionId, { type: 'notice', text: `${attempt.providerId} failed (${attemptError!.kind}) — retrying on ${next?.providerId}.` })
        continue
      }

      if (attemptError) { incomplete = true; return { assembled, toolCalls: [], incomplete, error: attemptError, finalProviderId, finalModel, ...(usage ? { usage } : {}) } }
      toolCalls = calls
      break
    }

    return { assembled, toolCalls, incomplete, finalProviderId, finalModel, ...(usage ? { usage } : {}) }
  }
}
