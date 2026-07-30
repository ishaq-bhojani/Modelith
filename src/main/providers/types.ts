import type { ChatMessage, ModelInfo, StreamEvent, ToolSpec } from '../../shared/types.js'

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface ProviderConfig {
  apiKey: string
  baseUrl?: string
  fetch: FetchLike
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  config: ProviderConfig
  /** Optional sampling temperature; omitted means the provider's default. */
  temperature?: number
  /** Tool definitions to advertise (agentic-edits spec §3); omitted = no tools. */
  tools?: ToolSpec[]
}

export interface Provider {
  readonly id: string
  readonly label: string
  readonly defaultBaseUrl: string
  /** False for local runtimes such as Ollama, which need no credential. */
  readonly requiresKey: boolean
  listModels(config: ProviderConfig): Promise<ModelInfo[]>
  streamChat(request: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent>
}
