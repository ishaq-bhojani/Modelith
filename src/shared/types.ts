export type Role = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: Role
  content: string
  createdAt: number
  incomplete?: boolean
}

export interface ModelInfo {
  id: string
  label: string
  contextWindow: number
}

export type ErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'context_overflow'
  | 'network'
  | 'provider_5xx'
  | 'aborted'
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
