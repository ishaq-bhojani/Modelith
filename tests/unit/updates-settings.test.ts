// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import React from 'react'
import { useAppStore } from '../../src/renderer/state/store.js'
import { SettingsDialog } from '../../src/renderer/settings/SettingsDialog.js'
import type { UpdateState } from '../../src/shared/types.js'

const BASE: UpdateState = {
  status: 'idle',
  canAutoInstall: true,
  currentVersion: '0.2.0',
  enabled: true,
  manualCheck: false,
}

function installBridge(): void {
  ;(window as unknown as { modelith: unknown }).modelith = {
    providers: { list: vi.fn().mockResolvedValue([]), models: vi.fn().mockResolvedValue([]) },
    keys: { has: vi.fn().mockResolvedValue(false), set: vi.fn(), delete: vi.fn() },
    updates: {
      getState: vi.fn().mockResolvedValue(BASE),
      check: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue(undefined),
      setEnabled: vi.fn().mockResolvedValue(undefined),
      onStateChange: vi.fn().mockReturnValue(() => {}),
    },
  }
}

describe('Settings — Updates section', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    installBridge()
    useAppStore.setState({ settingsOpen: true, update: BASE, error: null })
  })

  it('shows the current version', async () => {
    await act(async () => { createRoot(container).render(React.createElement(SettingsDialog)) })
    expect(container.querySelector('[data-testid="updates-version"]')?.textContent).toMatch(/0\.2\.0/)
  })

  it('reflects the enabled state in the toggle', async () => {
    await act(async () => { createRoot(container).render(React.createElement(SettingsDialog)) })
    const toggle = container.querySelector('[data-testid="updates-toggle"]') as HTMLInputElement
    expect(toggle.checked).toBe(true)
  })

  it('persists the toggle through the bridge', async () => {
    await act(async () => { createRoot(container).render(React.createElement(SettingsDialog)) })
    const toggle = container.querySelector('[data-testid="updates-toggle"]') as HTMLInputElement
    await act(async () => { toggle.click() })
    expect(window.modelith.updates.setEnabled).toHaveBeenCalledWith(false)
  })

  it('runs a manual check', async () => {
    await act(async () => { createRoot(container).render(React.createElement(SettingsDialog)) })
    const button = container.querySelector('[data-testid="updates-check-now"]') as HTMLButtonElement
    await act(async () => { button.click() })
    expect(window.modelith.updates.check).toHaveBeenCalled()
  })

  it('explains why macOS cannot install automatically', async () => {
    useAppStore.setState({ update: { ...BASE, canAutoInstall: false } })
    await act(async () => { createRoot(container).render(React.createElement(SettingsDialog)) })
    expect(container.querySelector('[data-testid="updates-status"]')?.textContent)
      .toMatch(/manual|download|cannot/i)
  })
})
