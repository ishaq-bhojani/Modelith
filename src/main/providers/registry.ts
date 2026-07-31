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

/**
 * Providers that can read image attachments (spec §B.2). Conservative: only
 * those with broad, reliable vision support are marked true, so the composer's
 * "may not read images" note errs toward warning rather than false confidence.
 * OpenRouter routes to many vision models; Ollama runs vision models locally.
 */
const VISION = new Set(['anthropic', 'openrouter', 'ollama', 'fake'])

/**
 * Providers with tool-calling support (agentic-edits spec §3, decision C:
 * Anthropic + OpenAI-compatible first). Ollama tool support is model-dependent
 * and folded in later; local LM Studio likewise depends on the loaded model.
 */
const TOOLS = new Set(['anthropic', 'openrouter', 'deepseek', 'groq', 'kimi', 'fake'])

/** Chromium's network stack, so system proxy configuration is honoured. */
export const mainFetch: FetchLike = (url, init) => net.fetch(url, init)

const fakeProvider: Provider = {
  id: 'fake', label: 'Fake (test)', defaultBaseUrl: 'http://localhost', requiresKey: false,
  listModels: async () => [{ id: 'fake-1', label: 'fake-1', contextWindow: 8000 }],
  async *streamChat(req, signal) {
    // When a prompt asks for "canvas", emit a small HTML artifact so the canvas
    // pane can be exercised in E2E. No existing test uses that word, so the
    // default greeting path is unaffected.
    const lastMsg = req.messages[req.messages.length - 1]
    const lastUserMsg = [...req.messages].reverse().find((m) => m.role === 'user')
    const lastUser = lastUserMsg?.content ?? ''

    // Agentic-edits E2E: when tools are offered and the prompt asks to edit,
    // emit a tool call; once its result comes back (last message is role:'tool'),
    // finish with a short confirmation.
    if (req.tools && req.tools.length > 0) {
      if (lastMsg?.role === 'tool') {
        for (const c of ['Done', ' — ', 'applied.']) {
          if (signal.aborted) return
          await new Promise((r) => setTimeout(r, 12))
          yield { type: 'text' as const, delta: c }
        }
        yield { type: 'done' as const }
        return
      }
      const callId = `call-${req.messages.length}`
      if (/agent mcp/i.test(lastUser)) {
        const mcpTool = req.tools.find((t) => t.name.startsWith('mcp__'))
        if (mcpTool) {
          yield { type: 'tool_call' as const, id: callId, name: mcpTool.name, arguments: JSON.stringify({ text: 'hi' }) }
          yield { type: 'done' as const }
          return
        }
      }
      if (/agent run/i.test(lastUser)) {
        yield { type: 'tool_call' as const, id: callId, name: 'run_command', arguments: JSON.stringify({ command: 'echo oc-ran' }) }
        yield { type: 'done' as const }
        return
      }
      if (/agent write|create file/i.test(lastUser)) {
        yield { type: 'tool_call' as const, id: callId, name: 'write_file', arguments: JSON.stringify({ path: 'notes.txt', content: 'hello from the agent\n' }) }
        yield { type: 'done' as const }
        return
      }
      if (/agent escape/i.test(lastUser)) {
        yield { type: 'tool_call' as const, id: callId, name: 'write_file', arguments: JSON.stringify({ path: '../escape.txt', content: 'nope' }) }
        yield { type: 'done' as const }
        return
      }
    }
    // Echo received image attachments so E2E can prove they reached the provider.
    const imgs = (lastUserMsg?.attachments ?? []).filter((a) => a.type === 'image')
    if (imgs.length > 0) {
      for (const c of [`GOT_IMAGE:${imgs.length}:`, imgs.map((a) => a.mimeType).join(',')]) {
        if (signal.aborted) return
        await new Promise((r) => setTimeout(r, 15))
        yield { type: 'text' as const, delta: c }
      }
      yield { type: 'done' as const }
      return
    }
    // Deliberate keyword triggers so E2E can exercise each canvas render path.
    // No existing test uses these words, so the default greeting is unaffected.
    let chunks: string[]
    if (/multicanvas/i.test(lastUser)) chunks = ['```html\n', '<h1>Page</h1>\n', '```\n\n', '```mermaid\n', 'graph TD;\nA-->B;\n', '```\n']
    else if (/twoversions/i.test(lastUser)) chunks = ['```html\n', '<h1 id="t">v1</h1>\n', '```\n\n', 'Bigger:\n\n', '```html\n', '<h1 id="t">v2</h1>\n', '```\n']
    else if (/badmermaid/i.test(lastUser)) chunks = ['```mermaid\n', 'not a valid diagram <<<\n', '```\n']
    else if (/mermaid/i.test(lastUser)) chunks = ['```mermaid\n', 'graph TD;\n', 'A-->B;\n', '```\n']
    else if (/canvas/i.test(lastUser)) chunks = ['Here is a page.\n\n', '```html\n', '<h1 id="t">Hello canvas</h1>\n', '```\n']
    else chunks = ['Hello', ' from', ' the', ' fake', ' provider']

    for (const c of chunks) {
      if (signal.aborted) return
      await new Promise((r) => setTimeout(r, 18))
      yield { type: 'text' as const, delta: c }
    }
    yield { type: 'done' as const }
  },
}

const providers: Provider[] = [
  ...(process.env['MODELITH_FAKE_PROVIDER'] === '1' ? [fakeProvider] : []),
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
    vision: VISION.has(p.id),
    tools: TOOLS.has(p.id),
  }))
}
