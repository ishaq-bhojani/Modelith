import { runProviderContract } from '../contract/provider-contract.js'
import { ollamaFixtures } from '../fixtures/ollama.js'
import { createOllamaProvider } from '../../src/main/providers/ollama.js'

runProviderContract('ollama', createOllamaProvider, ollamaFixtures)
