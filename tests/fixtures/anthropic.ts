import type { ContractFixtures } from '../contract/provider-contract.js'

const delta = (text: string) =>
  `event: content_block_delta\ndata: ${JSON.stringify({
    type: 'content_block_delta', delta: { type: 'text_delta', text },
  })}\n\n`

export const anthropicFixtures: ContractFixtures = {
  helloStream:
    `event: message_start\ndata: ${JSON.stringify({ type: 'message_start' })}\n\n` +
    delta('Hello') + delta(' world') +
    `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
  authErrorBody: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } }),
  rateLimitBody: JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }),
  modelsBody: JSON.stringify({
    data: [
      { id: 'claude-test-1', display_name: 'Claude Test 1' },
      { id: 'claude-test-2', display_name: 'Claude Test 2' },
    ],
  }),
}
