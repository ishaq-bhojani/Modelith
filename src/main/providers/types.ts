import type { ChatMessage, ModelInfo, StreamEvent } from '../../shared/types.js'

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
