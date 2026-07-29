import { runProviderContract } from '../contract/provider-contract.js'
import { anthropicFixtures } from '../fixtures/anthropic.js'
import { createAnthropicProvider } from '../../src/main/providers/anthropic.js'

runProviderContract('anthropic', createAnthropicProvider, anthropicFixtures)
