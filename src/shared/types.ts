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
  | { type: 'done'; usage?: Usage }
  | { type: 'error'; error: ProviderError }

/** One chat-stream event, tagged with the stream and session it belongs to. */
export interface StreamEnvelope {
  streamId: string
  sessionId: string
  event: StreamEvent
}
