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

// React tracks the native element's value setter to detect real user input;
// assigning `.value = ...` directly is invisible to it, so the subsequent
// 'input' event would be ignored. Going through the native prototype setter
// (bypassing React's wrapper) is the standard workaround.
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
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

  // Finding 1: `category` used to initialise once and never reset, so
  // reopening Settings landed wherever the user last left it. Error-recovery
  // affordances (auth errors, "no model selected") open Settings expecting
  // Provider — landing on Modes instead hides the fix.
  it('reopens on Provider even if it was closed on a different category', async () => {
    await render(container)
    await click(container, 'settings-tab-modes')
    expect(container.querySelector('[data-testid="settings-tab-modes"]')?.getAttribute('aria-selected')).toBe('true')

    // The dialog component never unmounts (App.tsx renders it unconditionally
    // and it returns null while closed) — closing and reopening it here means
    // toggling `settingsOpen`, exactly as the real "Open settings" affordances do.
    await act(async () => { useAppStore.setState({ settingsOpen: false }) })
    await act(async () => { useAppStore.setState({ settingsOpen: true }) })

    expect(container.querySelector('[data-testid="provider-select"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="settings-tab-provider"]')?.getAttribute('aria-selected')).toBe('true')
  })

  // Findings 2 & 4: modeName/modePrompt/models/configured used to live inside
  // the panels themselves, so unmounting on a category switch silently
  // discarded them. They were lifted to the shell (mirroring `draftKey`).
  it('keeps a half-typed mode name and prompt when leaving and returning to Modes', async () => {
    await render(container)
    await click(container, 'settings-tab-modes')

    const nameInput = container.querySelector('[data-testid="mode-name"]') as HTMLInputElement
    await act(async () => { setNativeValue(nameInput, 'Rust reviewer') })
    const promptInput = container.querySelector('[data-testid="mode-prompt"]') as HTMLTextAreaElement
    await act(async () => { setNativeValue(promptInput, 'You are a meticulous Rust reviewer.') })

    await click(container, 'settings-tab-provider')
    await click(container, 'settings-tab-modes')

    const nameReturned = container.querySelector('[data-testid="mode-name"]') as HTMLInputElement
    const promptReturned = container.querySelector('[data-testid="mode-prompt"]') as HTMLTextAreaElement
    expect(nameReturned.value).toBe('Rust reviewer')
    expect(promptReturned.value).toBe('You are a meticulous Rust reviewer.')
  })

  // Finding 6: `aria-controls` is deliberately set only on the selected tab
  // because the other panels are not mounted and their target id does not
  // exist. Pins that decision so it cannot silently drift.
  it('sets aria-controls only on the active tab', async () => {
    await render(container)
    expect(container.querySelector('[data-testid="settings-tab-provider"]')?.getAttribute('aria-controls')).toBe('settings-panel')
    for (const id of ['failover', 'modes', 'updates']) {
      expect(container.querySelector(`[data-testid="settings-tab-${id}"]`)?.hasAttribute('aria-controls')).toBe(false)
    }

    await click(container, 'settings-tab-modes')
    expect(container.querySelector('[data-testid="settings-tab-modes"]')?.getAttribute('aria-controls')).toBe('settings-panel')
    for (const id of ['provider', 'failover', 'updates']) {
      expect(container.querySelector(`[data-testid="settings-tab-${id}"]`)?.hasAttribute('aria-controls')).toBe(false)
    }
  })

  it('groups the rail under Connection, Workspace and Application', async () => {
    await render(container)
    const text = container.querySelector('[role="tablist"]')?.textContent ?? ''
    expect(text).toContain('Connection')
    expect(text).toContain('Workspace')
    expect(text).toContain('Application')
  })

  it('names the provider tab for what the panel actually does', async () => {
    await render(container)
    expect(container.querySelector('[data-testid="settings-tab-provider"]')?.textContent)
      .toContain('Provider & key')
  })

  it('shows OFF against Failover when no fallback is configured', async () => {
    useAppStore.setState({ fallbacks: [] })
    await render(container)
    expect(container.querySelector('[data-testid="settings-rail-state-failover"]')?.textContent)
      .toMatch(/off/i)
  })

  it('shows the mode count against Modes', async () => {
    useAppStore.setState({
      modes: [
        { id: 'a', name: 'A', systemPrompt: 'p', providerId: 'anthropic', model: 'm' },
        { id: 'b', name: 'B', systemPrompt: 'p', providerId: 'anthropic', model: 'm' },
      ],
    })
    await render(container)
    expect(container.querySelector('[data-testid="settings-rail-state-modes"]')?.textContent).toBe('2')
  })

  it('marks Updates only when there is something to act on', async () => {
    useAppStore.setState({ update: null })
    await render(container)
    expect(container.querySelector('[data-testid="settings-rail-state-updates"]')).toBeNull()
  })

  it('closes with an icon button rather than a text glyph', async () => {
    await render(container)
    const close = container.querySelector('[data-testid="settings-close-x"]')
    expect(close?.querySelector('svg')).not.toBeNull()
    expect(close?.textContent).toBe('')
  })
})
