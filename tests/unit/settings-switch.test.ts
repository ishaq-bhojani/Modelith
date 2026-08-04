// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import React from 'react'
import { Switch } from '../../src/renderer/app/Switch.js'

describe('Switch', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  function render(props: Parameters<typeof Switch>[0]): void {
    act(() => { createRoot(container).render(React.createElement(Switch, props)) })
  }

  it('exposes itself as a switch to assistive tech', () => {
    render({ checked: true, onChange: () => {}, label: 'Check automatically' })
    const el = container.querySelector('[role="switch"]')
    expect(el).not.toBeNull()
    expect(el?.getAttribute('aria-checked')).toBe('true')
    expect(el?.getAttribute('aria-label')).toBe('Check automatically')
  })

  it('reports aria-checked false when off', () => {
    render({ checked: false, onChange: () => {}, label: 'Check automatically' })
    expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
  })

  it('calls onChange with the toggled value', () => {
    const onChange = vi.fn()
    render({ checked: false, onChange, label: 'Check automatically' })
    const el = container.querySelector('[role="switch"]') as HTMLButtonElement
    act(() => { el.click() })
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('is a real button so it is keyboard reachable', () => {
    render({ checked: false, onChange: () => {}, label: 'x' })
    expect(container.querySelector('[role="switch"]')?.tagName).toBe('BUTTON')
  })

  it('carries a test id when given one', () => {
    render({ checked: false, onChange: () => {}, label: 'x', testId: 'updates-toggle' })
    expect(container.querySelector('[data-testid="updates-toggle"]')).not.toBeNull()
  })
})
