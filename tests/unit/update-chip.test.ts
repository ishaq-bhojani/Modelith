// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import React from 'react'
import { useAppStore } from '../../src/renderer/state/store.js'
import { UpdateChip } from '../../src/renderer/app/UpdateChip.js'
import type { UpdateState } from '../../src/shared/types.js'

const BASE: UpdateState = {
  status: 'idle',
  canAutoInstall: true,
  currentVersion: '0.2.0',
  enabled: true,
  manualCheck: false,
}

function render(container: HTMLDivElement): void {
  act(() => { createRoot(container).render(React.createElement(UpdateChip)) })
}

function setUpdate(patch: Partial<UpdateState>): void {
  useAppStore.setState({ update: { ...BASE, ...patch }, updateChipDismissed: false })
}

describe('UpdateChip', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    ;(window as unknown as { modelith: unknown }).modelith = {
      updates: {
        install: vi.fn().mockResolvedValue(undefined),
        check: vi.fn().mockResolvedValue(undefined),
        setEnabled: vi.fn().mockResolvedValue(undefined),
        getState: vi.fn().mockResolvedValue(BASE),
        onStateChange: vi.fn().mockReturnValue(() => {}),
      },
    }
    useAppStore.setState({ update: null, updateChipDismissed: false })
  })

  it('renders nothing while idle', () => {
    setUpdate({ status: 'idle' })
    render(container)
    expect(container.textContent).toBe('')
  })

  it('renders nothing while checking or downloading, so it never flickers', () => {
    setUpdate({ status: 'checking' })
    render(container)
    expect(container.textContent).toBe('')
  })

  it('prompts to restart once the download is ready', () => {
    setUpdate({ status: 'ready', latestVersion: '0.3.0' })
    render(container)
    expect(container.textContent).toMatch(/restart/i)
  })

  it('calls install when the ready chip is clicked', () => {
    setUpdate({ status: 'ready', latestVersion: '0.3.0' })
    render(container)
    const button = container.querySelector('[data-testid="update-chip-action"]') as HTMLButtonElement
    act(() => { button.click() })
    expect(window.modelith.updates.install).toHaveBeenCalled()
  })

  it('offers a download link instead of restart when the platform cannot auto-install', () => {
    setUpdate({ status: 'available', canAutoInstall: false, latestVersion: '0.3.0' })
    render(container)
    expect(container.textContent).toMatch(/download/i)
    expect(container.textContent).toMatch(/0\.3\.0/)
  })

  it('stays hidden on a background failure, so a failed check never nags', () => {
    setUpdate({ status: 'error', manualCheck: false, message: 'The update check failed.' })
    render(container)
    expect(container.textContent).toBe('')
  })

  it('shows a failure the user explicitly asked for', () => {
    setUpdate({ status: 'error', manualCheck: true, message: 'The update check failed.' })
    render(container)
    expect(container.textContent).toMatch(/failed/i)
  })

  it('hides once dismissed', () => {
    setUpdate({ status: 'ready', latestVersion: '0.3.0' })
    useAppStore.setState({ updateChipDismissed: true })
    render(container)
    expect(container.textContent).toBe('')
  })
})
