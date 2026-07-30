// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import React from 'react'
import { useAppStore } from '../../src/renderer/state/store.js'
import { SettingsDialog } from '../../src/renderer/settings/SettingsDialog.js'

// SettingsDialog reads `window.openCoder` directly (it is not written to go
// through the store's own IPC-calling actions), so every bridge call must be
// mocked here rather than assumed to exist under jsdom.
function installBridge(overrides: Partial<typeof window.openCoder> = {}): void {
  ;(window as unknown as { openCoder: unknown }).openCoder = {
    providers: { list: vi.fn().mockResolvedValue([{ id: 'anthropic', label: 'Anthropic', defaultBaseUrl: 'https://api.anthropic.com/v1', dataPolicy: { trainsOnInput: false, local: false } }]) },
    keys: {
      has: vi.fn().mockResolvedValue(false),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  }
}

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  // React tracks the native input's value setter to detect real user input;
  // assigning `input.value = ...` directly is invisible to it, so the
  // subsequent 'input' event would be ignored. Going through the native
  // prototype setter (bypassing React's wrapper) is the standard workaround.
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('SettingsDialog error surfacing', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    useAppStore.setState({
      settingsOpen: true, providerId: 'anthropic', model: '', error: null,
    })
  })

  it('reports a failed key save through the store error field instead of failing silently', async () => {
    installBridge({
      providers: {
        list: vi.fn().mockResolvedValue([{ id: 'anthropic', label: 'Anthropic', defaultBaseUrl: 'https://api.anthropic.com/v1', dataPolicy: { trainsOnInput: false, local: false } }]),
        models: vi.fn().mockResolvedValue([]),
      } as unknown as typeof window.openCoder.providers,
      keys: {
        has: vi.fn().mockResolvedValue(false),
        // Mirrors Keystore.set's real failure mode: it throws when the OS
        // keychain is unavailable (safeStorage.isEncryptionAvailable() false).
        set: vi.fn().mockRejectedValue(new Error('OS encryption is unavailable; refusing to store the key')),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    })

    const root = createRoot(container)
    await act(async () => {
      root.render(React.createElement(SettingsDialog))
    })
    // Let the mount-time effects (providers.list / keys.has / providers.models) settle.
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const input = container.querySelector('[data-testid="api-key-input"]') as HTMLInputElement
    await act(async () => { setNativeInputValue(input, 'sk-test') })

    const saveButton = container.querySelector('[data-testid="api-key-save"]') as HTMLButtonElement
    expect(saveButton.disabled).toBe(false)

    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(useAppStore.getState().error).not.toBeNull()
    expect(useAppStore.getState().error?.message).toContain('OS encryption is unavailable')

    root.unmount()
  })
})
