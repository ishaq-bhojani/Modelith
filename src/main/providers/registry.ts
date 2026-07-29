import { net } from 'electron'
import { createOpenAiCompatProvider } from './openai-compat.js'
import { createAnthropicProvider } from './anthropic.js'
import { createOllamaProvider } from './ollama.js'
import type { FetchLike, Provider } from './types.js'

/** Chromium's network stack, so system proxy configuration is honoured. */
export const mainFetch: FetchLike = (url, init) => net.fetch(url, init)

const fakeProvider: Provider = {
  id: 'fake', label: 'Fake (test)', defaultBaseUrl: 'http://localhost', requiresKey: false,
  listModels: async () => [{ id: 'fake-1', label: 'fake-1', contextWindow: 8000 }],
  async *streamChat(_req, signal) {
    for (const word of ['Hello', ' from', ' the', ' fake', ' provider']) {
      if (signal.aborted) return
      await new Promise((r) => setTimeout(r, 20))
      yield { type: 'text' as const, delta: word }
    }
    yield { type: 'done' as const }
  },
}

const providers: Provider[] = [
  ...(process.env['OPEN_CODER_FAKE_PROVIDER'] === '1' ? [fakeProvider] : []),
  createAnthropicProvider(),
  createOllamaProvider(),
  createOpenAiCompatProvider({ id: 'kimi', label: 'Kimi (Moonshot)', defaultBaseUrl: 'https://api.moonshot.cn/v1' }),
  createOpenAiCompatProvider({ id: 'openrouter', label: 'OpenRouter', defaultBaseUrl: 'https://openrouter.ai/api/v1' }),
  createOpenAiCompatProvider({ id: 'deepseek', label: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com/v1' }),
  createOpenAiCompatProvider({ id: 'groq', label: 'Groq', defaultBaseUrl: 'https://api.groq.com/openai/v1' }),
  createOpenAiCompatProvider({ id: 'lmstudio', label: 'LM Studio (local)', defaultBaseUrl: 'http://localhost:1234/v1' }),
]

export const registry = new Map(providers.map((p) => [p.id, p]))

export function getProvider(id: string): Provider {
  const provider = registry.get(id)
  if (!provider) throw new Error(`Unknown provider: ${id}`)
  return provider
}

export function listProviders(): { id: string; label: string; defaultBaseUrl: string }[] {
  return [...registry.values()].map((p) => ({ id: p.id, label: p.label, defaultBaseUrl: p.defaultBaseUrl }))
}
