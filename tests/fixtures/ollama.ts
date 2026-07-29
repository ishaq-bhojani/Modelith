import type { ContractFixtures } from '../contract/provider-contract.js'

const line = (content: string, done = false) =>
  `${JSON.stringify({ message: { role: 'assistant', content }, done })}\n`

export const ollamaFixtures: ContractFixtures = {
  helloStream: line('Hello') + line(' world') + line('', true),
  authErrorBody: JSON.stringify({ error: 'unauthorized' }),
  rateLimitBody: JSON.stringify({ error: 'too many requests' }),
  modelsBody: JSON.stringify({
    models: [{ name: 'llama-test-1' }, { name: 'llama-test-2' }],
  }),
  // Ollama streams newline-delimited JSON, not SSE.
  contentType: 'application/x-ndjson',
}
