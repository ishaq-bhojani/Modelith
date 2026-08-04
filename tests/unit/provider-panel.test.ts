// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import React from 'react'
import { ProviderPanel } from '../../src/renderer/settings/panels/ProviderPanel.js'
import type { ProviderSummary } from '../../src/shared/types.js'

const PROVIDERS: ProviderSummary[] = [
  { id: 'anthropic', label: 'Anthropic', defaultBaseUrl: 'https://api.anthropic.com/v1', dataPolicy: { trainsOnInput: false, local: false }, vision: true, tools: true },
  { id: 'ollama', label: 'Ollama', defaultBaseUrl: 'http://localhost:11434', dataPolicy: { trainsOnInput: false, local: true }, vision: false, tools: false },
]

describe('ProviderPanel', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    ;(window as unknown as { modelith: unknown }).modelith = {
      keys: { has: vi.fn().mockResolvedValue(true), set: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) },
      providers: { models: vi.fn().mockResolvedValue([]) },
    }
  })

  async function render(over: Record<string, unknown> = {}): Promise<void> {
    const props = {
      providers: PROVIDERS, draftKey: '', setDraftKey: () => {},
      models: [], configured: true, setConfigured: () => {}, setModels: () => {},
      autoFocus: false, onProviderFocused: () => {},
      ...over,
    }
    await act(async () => {
      createRoot(container).render(React.createElement(ProviderPanel, props as never))
    })
  }

  it('states what the panel configures', async () => {
    await render()
    expect(container.querySelector('.panel-head h4')?.textContent).toBe('Provider & key')
    expect(container.querySelector('.panel-head p')?.textContent).toMatch(/keychain/i)
  })

  it('shows the key state prominently rather than as grey filler', async () => {
    await render({ configured: true })
    expect(container.querySelector('[data-testid="key-status"]')?.textContent).toMatch(/keychain|stored/i)
  })

  it('does not use a native select for the provider', async () => {
    await render()
    expect(container.querySelector('select')).toBeNull()
  })

  it('reveals the provider list only after Change is pressed', async () => {
    await render()
    expect(container.querySelectorAll('[data-testid="provider-option"]').length).toBe(0)
    const change = container.querySelector('[data-testid="provider-select"]') as HTMLButtonElement
    await act(async () => { change.click() })
    expect(container.querySelectorAll('[data-testid="provider-option"]').length).toBe(PROVIDERS.length)
  })

  it('renders a model row per model with its context window', async () => {
    await render({ models: [{ id: 'm1', label: 'claude-sonnet', contextWindow: 200000 }] })
    const row = container.querySelector('[data-testid="model-option"]')
    expect(row?.textContent).toContain('claude-sonnet')
    expect(row?.textContent).toMatch(/200k/i)
  })

  it('omits the context column when the model does not report one', async () => {
    await render({ models: [{ id: 'm1', label: 'local-model' }] })
    const row = container.querySelector('[data-testid="model-option"]')
    expect(row?.textContent).toContain('local-model')
    expect(row?.textContent).not.toMatch(/undefined|NaN/)
  })
})
