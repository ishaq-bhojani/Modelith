// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import React from 'react'
import { ProviderPanel } from '../../src/renderer/settings/panels/ProviderPanel.js'
import { useAppStore } from '../../src/renderer/state/store.js'
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
    // The panel reads `providerId`/`model` straight from the real store (not
    // a prop), so each test starts from a known baseline instead of
    // inheriting whatever an earlier test last set.
    useAppStore.setState({ providerId: PROVIDERS[0]!.id, model: '' })
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

  // Finding 3: pre-branch this read "Save key" in both states. "Replace"
  // only makes sense once a key already exists to replace.
  it('labels the save button "Save key" on a fresh install with no key stored', async () => {
    await render({ configured: false, draftKey: 'sk-test' })
    expect(container.querySelector('[data-testid="api-key-save"]')?.textContent).toBe('Save key')
  })

  it('labels the save button "Replace" once a key is already stored', async () => {
    await render({ configured: true, draftKey: 'sk-test' })
    expect(container.querySelector('[data-testid="api-key-save"]')?.textContent).toBe('Replace')
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

  // Finding 1: the rebuilt key-entry row dropped the pre-redesign
  // `<label htmlFor="apikey">`, leaving the input's accessible name to fall
  // back to its placeholder — which itself changes text with `configured`.
  // A screen-reader user must get one stable name, not one derived from
  // shifting placeholder copy.
  it('gives the key input a real accessible name via a label, not just a placeholder', async () => {
    await render({ configured: false })
    const input = container.querySelector('[data-testid="api-key-input"]')
    const label = container.querySelector('label[for="apikey"]')
    expect(input).not.toBeNull()
    expect(input?.getAttribute('id')).toBe('apikey')
    expect(label?.textContent).toBe('API key')
  })

  it('keeps the key input label stable regardless of configured state', async () => {
    await render({ configured: true })
    expect(container.querySelector('label[for="apikey"]')?.textContent).toBe('API key')
  })

  it('does not use listbox/option roles for the model list — it is plain Tab-reachable buttons, matching the provider list', async () => {
    await render({ models: [{ id: 'm1', label: 'claude-sonnet', contextWindow: 200000 }] })
    // Those roles imply a roving-tabindex/arrow-key keyboard pattern this
    // list does not implement — pinning their absence, not the absence of
    // selection state (see the aria-pressed tests below, which restore what
    // an earlier fix round over-corrected away along with the roles).
    expect(container.querySelector('[data-testid="model-select"]')?.getAttribute('role')).toBeNull()
    expect(container.querySelector('[data-testid="model-option"]')?.getAttribute('role')).toBeNull()
  })

  // Finding 1: a plain `<button>` with only a check icon (aria-hidden, per
  // src/renderer/app/icons.tsx) announces no selection state to assistive
  // tech — the native `<select>` this replaced announced it for free.
  // `aria-pressed` restores that without reintroducing listbox/option roles,
  // which would imply keyboard behaviour (roving tabindex / arrow keys) this
  // list does not implement.
  it('marks the current model row with aria-pressed, and only that row', async () => {
    useAppStore.setState({ model: 'm2' })
    await render({
      models: [
        { id: 'm1', label: 'claude-haiku' },
        { id: 'm2', label: 'claude-sonnet' },
      ],
    })
    const rows = container.querySelectorAll('[data-testid="model-option"]')
    expect(rows[0]!.getAttribute('aria-pressed')).toBe('false')
    expect(rows[1]!.getAttribute('aria-pressed')).toBe('true')
  })

  it('calls setModel with the clicked model id', async () => {
    useAppStore.setState({ model: 'm1' })
    await render({
      models: [
        { id: 'm1', label: 'claude-haiku' },
        { id: 'm2', label: 'claude-sonnet' },
      ],
    })
    const rows = container.querySelectorAll('[data-testid="model-option"]')
    await act(async () => { (rows[1] as HTMLButtonElement).click() })
    expect(useAppStore.getState().model).toBe('m2')
  })

  it('marks the current provider row with aria-pressed, and only that row', async () => {
    useAppStore.setState({ providerId: 'ollama' })
    await render()
    const change = container.querySelector('[data-testid="provider-select"]') as HTMLButtonElement
    await act(async () => { change.click() })
    const rows = container.querySelectorAll('[data-testid="provider-option"]')
    expect(rows[0]!.getAttribute('aria-pressed')).toBe('false') // anthropic
    expect(rows[1]!.getAttribute('aria-pressed')).toBe('true') // ollama
  })

  it('calls setProvider with the clicked provider id', async () => {
    useAppStore.setState({ providerId: 'anthropic' })
    await render()
    const change = container.querySelector('[data-testid="provider-select"]') as HTMLButtonElement
    await act(async () => { change.click() })
    const ollamaOption = Array.from(container.querySelectorAll('[data-testid="provider-option"]'))
      .find((el) => el.textContent?.includes('Ollama')) as HTMLButtonElement
    await act(async () => { ollamaOption.click() })
    expect(useAppStore.getState().providerId).toBe('ollama')
  })

  it('gives the Change button an accessible name that says which provider it changes', async () => {
    useAppStore.setState({ providerId: 'anthropic' })
    await render()
    const change = container.querySelector('[data-testid="provider-select"]')
    expect(change?.getAttribute('aria-label')).toMatch(/anthropic/i)
  })

  it('is a valid ARIA container when there are no models to list (no role, so a plain <p> child is not an ARIA violation)', async () => {
    await render({ models: [] })
    expect(container.querySelector('[data-testid="model-select"]')?.getAttribute('role')).toBeNull()
    expect(container.querySelector('[data-testid="model-select"] p.field-hint')).not.toBeNull()
  })
})
