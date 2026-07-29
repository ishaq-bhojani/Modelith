import { runProviderContract } from '../contract/provider-contract.js'
import { openAiCompatFixtures } from '../fixtures/openai-compat.js'
import { createOpenAiCompatProvider } from '../../src/main/providers/openai-compat.js'

runProviderContract(
  'openai-compat',
  () => createOpenAiCompatProvider({
    id: 'kimi',
    label: 'Kimi (Moonshot)',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
  }),
  openAiCompatFixtures,
)
