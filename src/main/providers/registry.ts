import { net } from 'electron'
import { createOpenAiCompatProvider } from './openai-compat.js'
import { createAnthropicProvider } from './anthropic.js'
import { createOllamaProvider } from './ollama.js'
import type { FetchLike, Provider } from './types.js'
import type { DataPolicy, ProviderSummary } from '../../shared/types.js'

/**
 * Plainly-stated data handling per provider, shown as a badge so a user knows
 * before pasting proprietary code whether the provider may train on it. Best
 * effort from public policies; conservative where a provider is ambiguous. A
 * provider with no entry falls back to "trains on input, remote" — the safe
 * assumption to surface rather than implying a stronger guarantee than we can.
 */
const DATA_POLICY: Record<string, DataPolicy> = {
  anthropic: { trainsOnInput: false, local: false, url: 'https://www.anthropic.com/legal/privacy' },
  kimi: { trainsOnInput: true, local: false },
  openrouter: { trainsOnInput: false, local: false, url: 'https://openrouter.ai/privacy' },
  deepseek: { trainsOnInput: true, local: false },
  groq: { trainsOnInput: false, local: false },
  ollama: { trainsOnInput: false, local: true },
  lmstudio: { trainsOnInput: false, local: true },
  fake: { trainsOnInput: false, local: true },
}

function dataPolicyFor(id: string): DataPolicy {
  return DATA_POLICY[id] ?? { trainsOnInput: true, local: false }
}

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

export function listProviders(): ProviderSummary[] {
  return [...registry.values()].map((p) => ({
    id: p.id,
    label: p.label,
    defaultBaseUrl: p.defaultBaseUrl,
    dataPolicy: dataPolicyFor(p.id),
  }))
}
