// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import React from 'react'
import { useAppStore } from '../../src/renderer/state/store.js'
import { Sidebar } from '../../src/renderer/sessions/Sidebar.js'

const PROJECTS = [
  { id: 'p1', name: 'Modelith', root: '/a', createdAt: 1, lastOpenedAt: 2 },
  { id: 'p2', name: 'Logitrax', root: '/b', createdAt: 1, lastOpenedAt: 1 },
]

function installBridge(): void {
  ;(window as unknown as { modelith: unknown }).modelith = {
    projects: {
      list: vi.fn().mockResolvedValue({ projects: PROJECTS, activeId: 'p1' }),
      create: vi.fn(), rename: vi.fn(), remove: vi.fn(), setActive: vi.fn(),
    },
    sessions: { setProject: vi.fn().mockResolvedValue(undefined) },
  }
}

async function render(container: HTMLDivElement): Promise<void> {
  await act(async () => { createRoot(container).render(React.createElement(Sidebar)) })
}

describe('Sidebar projects', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    installBridge()
    useAppStore.setState({
      projects: PROJECTS,
      activeProjectId: 'p1',
      sessions: [
        { id: 's1', title: 'In Modelith', updatedAt: 3, projectId: 'p1' },
        { id: 's2', title: 'In Logitrax', updatedAt: 2, projectId: 'p2' },
        { id: 's3', title: 'Old chat', updatedAt: 1 },
      ],
      activeSessionId: null,
      query: '',
    })
  })

  it('renders one group per project', async () => {
    await render(container)
    expect(container.querySelectorAll('[data-testid="project-group"]').length).toBe(2)
  })

  it('puts each session under its own project', async () => {
    await render(container)
    const groups = [...container.querySelectorAll('[data-testid="project-group"]')]
    const modelith = groups.find((g) => g.textContent?.includes('Modelith'))
    expect(modelith?.textContent).toContain('In Modelith')
    expect(modelith?.textContent).not.toContain('In Logitrax')
  })

  it('shows a session with no project under Unfiled', async () => {
    await render(container)
    expect(container.querySelector('[data-testid="unfiled-group"]')?.textContent).toContain('Old chat')
  })

  it('hides Unfiled entirely when every session has a project', async () => {
    useAppStore.setState({
      sessions: [{ id: 's1', title: 'In Modelith', updatedAt: 3, projectId: 'p1' }],
    })
    await render(container)
    // A fresh install must never see an empty Unfiled heading.
    expect(container.querySelector('[data-testid="unfiled-group"]')).toBeNull()
  })

  it('marks the active project with aria-current', async () => {
    await render(container)
    const rows = [...container.querySelectorAll('[data-testid="project-row"]')]
    const active = rows.find((r) => r.getAttribute('aria-current') === 'true')
    expect(active?.textContent).toContain('Modelith')
  })

  it('does not drop a session whose project no longer exists', async () => {
    // The state a non-destructive remove leaves behind if unfiling ever fails.
    useAppStore.setState({
      sessions: [{ id: 's9', title: 'Orphan', updatedAt: 1, projectId: 'gone' }],
    })
    await render(container)
    expect(container.textContent).toContain('Orphan')
  })
})
