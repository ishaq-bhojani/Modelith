export type Role = 'system' | 'user' | 'assistant' | 'tool'

/** A tool invocation the model requested (agentic-edits spec §3). */
export interface ToolCall {
  id: string
  name: string
  /** Raw JSON arguments as the model emitted them; parsed by the executor. */
  arguments: string
}

/** A tool definition advertised to a tool-calling provider. */
export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema for the tool's arguments object. */
  parameters: Record<string, unknown>
}

/**
 * A non-text part of a message (spec §B.1). Additive: `content` stays the
 * canonical text, so the fence scanner, secret scan, context budget, session
 * JSONL, and the streaming core all keep operating on `content` untouched —
 * only provider request builders and the composer learn about attachments.
 */
export interface Attachment {
  type: 'image'
  /** e.g. image/png. */
  mimeType: string
  /** base64-encoded bytes, without a `data:` prefix. */
  data: string
  name?: string
}

export interface ChatMessage {
  id: string
  role: Role
  content: string
  createdAt: number
  /** Non-text parts (images) sent with this message; absent on most messages. */
  attachments?: Attachment[]
  /** Tool calls an assistant message requested (agentic-edits spec §3). */
  toolCalls?: ToolCall[]
  /** For a role:'tool' result message, the call id it answers. */
  toolCallId?: string
  /** The user-turn id an assistant message belongs to, for one-click revert of
   *  all edits made in that turn (agentic-edits spec §5). */
  turnId?: string
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

/** One entry in the workspace file tree (spec §A.3), shared main↔renderer. */
export interface WorkspaceTreeEntry {
  /** POSIX-style path relative to the workspace root. */
  relPath: string
  name: string
  kind: 'dir' | 'file'
  size?: number
  /** False for oversized files; such entries are shown disabled, never read. */
  readable: boolean
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
  /** Whether the provider can read image attachments (spec §B.2). Conservative
   *  default false; the composer warns quietly when attaching to a false one. */
  vision: boolean
  /** Whether the provider supports tool calling (agentic-edits spec §3). */
  tools: boolean
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
  // A completed tool call the model requested this turn (agentic-edits spec §3).
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'error'; error: ProviderError }
  // Engine-originated status (never emitted by a provider), e.g. a failover
  // notice. Shown transiently above the streaming reply, not persisted.
  | { type: 'notice'; text: string }
  // Engine-originated: a write awaiting the user's approval at the diff gate
  // (agentic-edits spec §4). The renderer diffs `previous`→`proposed`.
  | { type: 'tool_pending'; callId: string; tool: string; relPath: string; previous: string | null; proposed: string }
  // Engine-originated: a tool call finished (activity line in the transcript).
  | { type: 'tool_result'; callId: string; name: string; ok: boolean; summary: string }

/** One chat-stream event, tagged with the stream and session it belongs to. */
export interface StreamEnvelope {
  streamId: string
  sessionId: string
  event: StreamEvent
}
