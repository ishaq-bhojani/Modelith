// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import React from 'react'
import { useAppStore } from '../../src/renderer/state/store.js'
import { SettingsDialog } from '../../src/renderer/settings/SettingsDialog.js'

function installBridge(): void {
  ;(window as unknown as { modelith: unknown }).modelith = {
    providers: { list: vi.fn().mockResolvedValue([]), models: vi.fn().mockResolvedValue([]) },
    keys: { has: vi.fn().mockResolvedValue(false), set: vi.fn(), delete: vi.fn() },
    updates: {
      getState: vi.fn().mockResolvedValue(null),
      check: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue(undefined),
      setEnabled: vi.fn().mockResolvedValue(undefined),
      onStateChange: vi.fn().mockReturnValue(() => {}),
    },
  }
}

async function render(container: HTMLDivElement): Promise<void> {
  await act(async () => { createRoot(container).render(React.createElement(SettingsDialog)) })
}

function click(container: HTMLDivElement, testid: string): Promise<void> {
  const el = container.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement
  return act(async () => { el.click() })
}

describe('Settings navigation', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    installBridge()
    useAppStore.setState({ settingsOpen: true, error: null, update: null })
  })

  it('renders one tab per category', async () => {
    await render(container)
    for (const id of ['provider', 'failover', 'modes', 'updates']) {
      expect(container.querySelector(`[data-testid="settings-tab-${id}"]`)).not.toBeNull()
    }
  })

  it('opens on Provider, so the most common settings need no navigation', async () => {
    await render(container)
    expect(container.querySelector('[data-testid="provider-select"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="settings-tab-provider"]')?.getAttribute('aria-selected')).toBe('true')
  })

  it('swaps the panel on click, unmounting the previous one', async () => {
    await render(container)
    await click(container, 'settings-tab-updates')
    expect(container.querySelector('[data-testid="updates-toggle"]')).not.toBeNull()
    // The old panel must be GONE, not merely hidden — a hidden panel would
    // still expose its controls to assistive tech and let tests pass against
    // a panel the user cannot see.
    expect(container.querySelector('[data-testid="provider-select"]')).toBeNull()
  })

  it('tracks aria-selected across a switch', async () => {
    await render(container)
    await click(container, 'settings-tab-modes')
    expect(container.querySelector('[data-testid="settings-tab-modes"]')?.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('[data-testid="settings-tab-provider"]')?.getAttribute('aria-selected')).toBe('false')
  })

  it('keeps a half-typed API key when leaving and returning to Provider', async () => {
    await render(container)
    const input = container.querySelector('[data-testid="api-key-input"]') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, 'sk-half-typed')
    await act(async () => { input.dispatchEvent(new Event('input', { bubbles: true })) })

    await click(container, 'settings-tab-updates')
    await click(container, 'settings-tab-provider')

    const returned = container.querySelector('[data-testid="api-key-input"]') as HTMLInputElement
    expect(returned.value).toBe('sk-half-typed')
  })

  it('exposes the rail as a tablist', async () => {
    await render(container)
    expect(container.querySelector('[role="tablist"]')).not.toBeNull()
    expect(container.querySelector('[role="tabpanel"]')).not.toBeNull()
  })
})
