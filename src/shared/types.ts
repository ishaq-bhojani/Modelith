export type Role = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: Role
  content: string
  createdAt: number
  incomplete?: boolean
  /** Provenance: the model that produced an assistant reply. Absent on user
   *  messages and on any message persisted before provenance was recorded, so
   *  it must always be treated as optional at the render layer. */
  model?: string
  /** Provenance: the provider that produced an assistant reply. */
  provider?: string
  /** Token counts from the provider's `done` event, used to derive cost. */
  usage?: Usage
}

export interface ModelInfo {
  id: string
  label: string
  contextWindow: number
}

/** Plainly-stated data handling for a provider, shown as a badge. */
export interface DataPolicy {
  /** Whether the provider may train on inputs sent to it. */
  trainsOnInput: boolean
  /** True for local runtimes that make no outbound call at all. */
  local: boolean
  /** Link to the provider's policy, when there is one to cite. */
  url?: string
}

export interface ProviderSummary {
  id: string
  label: string
  defaultBaseUrl: string
  dataPolicy: DataPolicy
}

/** A named preset: system prompt + model + temperature, applied to a turn. */
export interface Mode {
  id: string
  name: string
  systemPrompt: string
  providerId?: string
  model?: string
  temperature?: number
}

/** One message's place in what would be sent next, for the context inspector. */
export interface ContextPreviewEntry {
  id: string
  role: Role
  tokens: number
  included: boolean
  preview: string
}

export interface ContextPreview {
  entries: ContextPreviewEntry[]
  includedTokens: number
  totalTokens: number
  omittedCount: number
  budget: number
}

// No 'aborted' kind: an abort is renderer-initiated (the user clicked Stop),
// so the renderer already knows without needing an error event, and the
// engine deliberately never emits one for it (see stream-engine.ts). A kind
// nothing ever produces is dead weight, not a real case to route on.
export type ErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'context_overflow'
  | 'network'
  | 'provider_5xx'
  | 'busy'
  | 'no_model'
  | 'unknown'

export interface ProviderError {
  kind: ErrorKind
  message: string
  retryAfterSeconds?: number
}

export interface Usage {
  promptTokens?: number
  completionTokens?: number
}

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  // `model`/`provider` are the ones that ACTUALLY produced the reply (the
  // fallback, after failover). The engine adds them so the renderer can show an
  // accurate badge and cost immediately, without waiting for a reload. A
  // provider's own `done` may omit them; the engine fills them in.
  | { type: 'done'; usage?: Usage; model?: string; provider?: string }
  | { type: 'error'; error: ProviderError }
  // Engine-originated status (never emitted by a provider), e.g. a failover
  // notice. Shown transiently above the streaming reply, not persisted.
  | { type: 'notice'; text: string }

/** One chat-stream event, tagged with the stream and session it belongs to. */
export interface StreamEnvelope {
  streamId: string
  sessionId: string
  event: StreamEvent
}
