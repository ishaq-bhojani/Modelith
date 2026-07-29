import type { ContractFixtures } from '../contract/provider-contract.js'

const delta = (c: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`

export const openAiCompatFixtures: ContractFixtures = {
  helloStream: delta('Hello') + delta(' world') + 'data: [DONE]\n\n',
  authErrorBody: JSON.stringify({ error: { message: 'invalid api key', type: 'auth' } }),
  rateLimitBody: JSON.stringify({ error: { message: 'rate limit exceeded' } }),
}
