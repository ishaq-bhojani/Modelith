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

async function openUpdates(container: HTMLDivElement): Promise<void> {
  await act(async () => { createRoot(container).render(React.createElement(SettingsDialog)) })
  const tab = container.querySelector('[data-testid="settings-tab-updates"]') as HTMLButtonElement
  await act(async () => { tab.click() })
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
    await openUpdates(container)
    expect(container.querySelector('[data-testid="updates-version"]')?.textContent).toMatch(/0\.2\.0/)
  })

  it('reflects the enabled state in the toggle', async () => {
    await openUpdates(container)
    const toggle = container.querySelector('[data-testid="updates-toggle"]')
    expect(toggle?.getAttribute('aria-checked')).toBe('true')
  })

  it('persists the toggle through the bridge', async () => {
    await openUpdates(container)
    const toggle = container.querySelector('[data-testid="updates-toggle"]') as HTMLButtonElement
    await act(async () => { toggle.click() })
    expect(window.modelith.updates.setEnabled).toHaveBeenCalledWith(false)
  })

  it('rounds the download percentage to two decimals', async () => {
    // electron-updater reports a raw float, so the status line read
    // "Downloading… 90.35480160960444%" verbatim.
    useAppStore.setState({ update: { ...BASE, status: 'downloading', percent: 90.35480160960444 } })
    await openUpdates(container)
    const text = container.querySelector('[data-testid="updates-status"]')?.textContent
    expect(text).toContain('90.35%')
    expect(text).not.toContain('90.3548')
  })

  it('still shows two decimals for a whole-number percentage', async () => {
    useAppStore.setState({ update: { ...BASE, status: 'downloading', percent: 50 } })
    await openUpdates(container)
    expect(container.querySelector('[data-testid="updates-status"]')?.textContent).toContain('50.00%')
  })

  it('shows 0.00% before any progress arrives', async () => {
    useAppStore.setState({ update: { ...BASE, status: 'downloading' } })
    await openUpdates(container)
    expect(container.querySelector('[data-testid="updates-status"]')?.textContent).toContain('0.00%')
  })

  it('runs a manual check', async () => {
    await openUpdates(container)
    const button = container.querySelector('[data-testid="updates-check-now"]') as HTMLButtonElement
    await act(async () => { button.click() })
    expect(window.modelith.updates.check).toHaveBeenCalled()
  })

  it('explains why macOS cannot install automatically', async () => {
    useAppStore.setState({ update: { ...BASE, canAutoInstall: false } })
    await openUpdates(container)
    expect(container.querySelector('[data-testid="updates-status"]')?.textContent)
      .toMatch(/manual|download|cannot/i)
  })

  // Regression coverage for the self-contradictory copy the code review
  // flagged: appending the manual-install sentence unconditionally whenever
  // `canAutoInstall` is false produced nonsense like "Downloading… 40% This
  // build cannot install updates automatically…" for statuses where the
  // manual-install framing isn't actually true (mid-download, or already
  // downloaded and ready). Those two statuses must never carry that sentence,
  // even with `canAutoInstall: false` — asserting on its absence so a
  // regression reintroducing it fails.
  it('does not contradict itself while downloading, even when canAutoInstall is false', async () => {
    useAppStore.setState({ update: { ...BASE, status: 'downloading', percent: 40, canAutoInstall: false } })
    await openUpdates(container)
    const text = container.querySelector('[data-testid="updates-status"]')?.textContent ?? ''
    expect(text).toMatch(/download/i)
    expect(text).not.toMatch(/cannot install updates automatically/i)
  })

  it('does not contradict itself once ready, even when canAutoInstall is false', async () => {
    useAppStore.setState({ update: { ...BASE, status: 'ready', latestVersion: '0.3.0', canAutoInstall: false } })
    await openUpdates(container)
    const text = container.querySelector('[data-testid="updates-status"]')?.textContent ?? ''
    expect(text).toMatch(/ready|restart/i)
    expect(text).not.toMatch(/cannot install updates automatically/i)
  })

  // Pins the manual-install gate from both sides for the 'error' status,
  // which round-1 of the contradiction fix silently dropped: 'error' fell
  // through to `update.message ?? 'Update check failed.'` with no
  // `canAutoInstall` branch at all, so a macOS user whose check failed lost
  // the one piece of guidance telling them what to do about it.
  it('explains manual install when a check fails and canAutoInstall is false', async () => {
    useAppStore.setState({ update: { ...BASE, status: 'error', message: 'Network error.', canAutoInstall: false } })
    await openUpdates(container)
    const text = container.querySelector('[data-testid="updates-status"]')?.textContent ?? ''
    expect(text).toMatch(/network error/i)
    expect(text).toMatch(/manual|download|cannot/i)
  })

  it('does not append the manual-install sentence on error when canAutoInstall is true', async () => {
    useAppStore.setState({ update: { ...BASE, status: 'error', message: 'Network error.', canAutoInstall: true } })
    await openUpdates(container)
    const text = container.querySelector('[data-testid="updates-status"]')?.textContent ?? ''
    expect(text).toMatch(/network error/i)
    expect(text).not.toMatch(/cannot install updates automatically/i)
  })

  it('offers a restart action once an update is ready', async () => {
    useAppStore.setState({ update: { ...BASE, status: 'ready', latestVersion: '0.4.0' } })
    await openUpdates(container)
    const button = container.querySelector('[data-testid="updates-install"]')
    expect(button?.textContent).toMatch(/restart/i)
  })

  it('calls install when the restart action is clicked', async () => {
    useAppStore.setState({ update: { ...BASE, status: 'ready', latestVersion: '0.4.0' } })
    await openUpdates(container)
    const button = container.querySelector('[data-testid="updates-install"]') as HTMLButtonElement
    await act(async () => { button.click() })
    expect(window.modelith.updates.install).toHaveBeenCalled()
  })

  it('offers a download action when the platform cannot auto-install', async () => {
    useAppStore.setState({
      update: { ...BASE, status: 'available', canAutoInstall: false, latestVersion: '0.4.0' },
    })
    await openUpdates(container)
    expect(container.querySelector('[data-testid="updates-install"]')?.textContent).toMatch(/download/i)
  })

  it('offers no action while merely checking', async () => {
    useAppStore.setState({ update: { ...BASE, status: 'checking' } })
    await openUpdates(container)
    expect(container.querySelector('[data-testid="updates-install"]')).toBeNull()
  })

  it('offers no action when an update is available and will auto-install itself', async () => {
    // canAutoInstall platforms download automatically; the user acts at
    // 'ready', not before, so a button here would be premature.
    useAppStore.setState({
      update: { ...BASE, status: 'available', canAutoInstall: true, latestVersion: '0.4.0' },
    })
    await openUpdates(container)
    expect(container.querySelector('[data-testid="updates-install"]')).toBeNull()
  })

  it('splits the macOS caveat out of the status sentence', async () => {
    useAppStore.setState({
      update: { ...BASE, status: 'available', canAutoInstall: false, latestVersion: '0.4.0' },
    })
    await openUpdates(container)
    // The headline names the version; the explanation carries the caveat. They
    // are separate elements now, not one concatenated sentence.
    expect(container.querySelector('[data-testid="update-headline"]')?.textContent).toContain('0.4.0')
    expect(container.querySelector('[data-testid="update-explanation"]')?.textContent)
      .toMatch(/unsigned|manually|release page/i)
  })

  it('offers no state block when there is nothing to act on', async () => {
    useAppStore.setState({ update: { ...BASE, status: 'idle' } })
    await openUpdates(container)
    expect(container.querySelector('[data-testid="update-headline"]')).toBeNull()
  })
})
