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
      openFolder: vi.fn().mockResolvedValue(undefined),
    },
    sessions: {
      setProject: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue([]),
    },
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
    // Fix round 1, item 5: assert it lands specifically under Unfiled, not
    // merely somewhere in the container — the latter would also pass if the
    // orphan were rendered under the wrong (or no) group, which is the only
    // bug this test exists to catch.
    expect(container.querySelector('[data-testid="unfiled-group"]')?.textContent).toContain('Orphan')
    for (const group of container.querySelectorAll('[data-testid="project-group"]')) {
      expect(group.textContent).not.toContain('Orphan')
    }
  })
})

// Fix round 1, item 3: docs/superpowers/specs/2026-08-04-projects-design.md
// line 117 — "Each project is a collapsible group with its sessions beneath
// it." Dropped from task-5-brief.md; this covers it directly.
describe('Sidebar projects — collapse', () => {
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
      ],
      activeSessionId: null,
      query: '',
    })
  })

  function click(el: Element | null): Promise<void> {
    return act(async () => { (el as HTMLElement).click() })
  }

  // Every session row's move-session <select> lists every project name as an
  // <option>, so a naive `.textContent.includes(name)` on a whole
  // project-group can match the WRONG group (any group with at least one
  // session row contains every other project's name via that dropdown).
  // `.project-row`'s own textContent is just the collapse icon (no text) +
  // the bare name span + action-button icons (no text) — nothing else — so
  // it's the only reliable anchor.
  function groupNamed(name: string): HTMLElement {
    const rows = [...container.querySelectorAll('[data-testid="project-row"]')]
    const row = rows.find((r) => r.textContent === name)
    return row!.closest('[data-testid="project-group"]') as HTMLElement
  }

  it('starts expanded, so nothing collapses on first render', async () => {
    await render(container)
    const modelith = groupNamed('Modelith')
    expect(modelith.querySelector('[data-testid="project-collapse"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(modelith.textContent).toContain('In Modelith')
  })

  it('collapsing a group removes its sessions from the DOM, not just hides them visually', async () => {
    await render(container)
    const modelith = groupNamed('Modelith')
    await click(modelith.querySelector('[data-testid="project-collapse"]'))

    expect(modelith.querySelector('[data-testid="project-collapse"]')?.getAttribute('aria-expanded')).toBe('false')
    // Not just visually hidden: the row must actually be gone.
    expect(modelith.querySelector('.session-row')).toBeNull()
  })

  it('collapsing one project does not affect another', async () => {
    await render(container)
    const modelith = groupNamed('Modelith')
    const logitrax = groupNamed('Logitrax')
    await click(modelith.querySelector('[data-testid="project-collapse"]'))

    expect(logitrax.querySelector('[data-testid="project-collapse"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(logitrax.querySelector('.session-row')).not.toBeNull()
  })

  it('toggling the collapse control does not also change the active project', async () => {
    const setActive = vi.fn().mockResolvedValue({ projects: PROJECTS, activeId: 'p1' })
    ;(window as unknown as { modelith: { projects: { setActive: unknown } } }).modelith.projects.setActive = setActive
    await render(container)
    const logitrax = groupNamed('Logitrax')
    await click(logitrax.querySelector('[data-testid="project-collapse"]'))

    expect(setActive).not.toHaveBeenCalled()
  })

  it('expanding again restores the sessions', async () => {
    await render(container)
    const modelith = groupNamed('Modelith')
    const toggle = () => modelith.querySelector('[data-testid="project-collapse"]')
    await click(toggle())
    await click(toggle())

    expect(toggle()?.getAttribute('aria-expanded')).toBe('true')
    expect(modelith.querySelector('.session-row')).not.toBeNull()
  })
})

// Fix round 1, item 4: spec line 126, "Project → Rename, Open folder,
// Remove" — only Rename and Remove existed.
describe('Sidebar projects — open folder', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    installBridge()
    useAppStore.setState({
      projects: PROJECTS,
      activeProjectId: 'p1',
      sessions: [{ id: 's1', title: 'In Modelith', updatedAt: 3, projectId: 'p1' }],
      activeSessionId: null,
      query: '',
    })
  })

  it('passes only the project id to the bridge, never the root string it already has', async () => {
    await render(container)
    const rows = [...container.querySelectorAll('[data-testid="project-row"]')]
    const modelithRow = rows.find((r) => r.textContent === 'Modelith')!
    const button = modelithRow.querySelector('[data-testid="project-open-folder"]') as HTMLButtonElement

    await act(async () => { button.click() })

    const openFolder = (window as unknown as { modelith: { projects: { openFolder: ReturnType<typeof vi.fn> } } })
      .modelith.projects.openFolder
    expect(openFolder).toHaveBeenCalledWith('p1')
  })

  it('does not also select the project as active', async () => {
    const setActive = vi.fn().mockResolvedValue({ projects: PROJECTS, activeId: 'p1' })
    ;(window as unknown as { modelith: { projects: { setActive: unknown } } }).modelith.projects.setActive = setActive
    await render(container)
    const rows = [...container.querySelectorAll('[data-testid="project-row"]')]
    const logitraxRow = rows.find((r) => r.textContent === 'Logitrax')!
    const button = logitraxRow.querySelector('[data-testid="project-open-folder"]') as HTMLButtonElement

    await act(async () => { button.click() })

    expect(setActive).not.toHaveBeenCalled()
  })
})

// Whole-branch review M7: with projects present and nothing matching the
// filter, the empty state rendered ABOVE the project groups — a line saying
// there is nothing here, sitting on top of the headings it is talking about.
describe('Sidebar empty state placement', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    installBridge()
  })

  /** Document order of the empty-state line vs. the first project group. */
  function emptyStateComesAfterGroups(): boolean {
    const empty = container.querySelector('.sidebar-empty')!
    const firstGroup = container.querySelector('[data-testid="project-group"]')!
    return (firstGroup.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  }

  it('renders the no-matches line below the project groups, not above them', async () => {
    useAppStore.setState({
      projects: PROJECTS,
      activeProjectId: 'p1',
      sessions: [{ id: 's1', title: 'In Modelith', updatedAt: 3, projectId: 'p1' }],
      activeSessionId: null,
      query: 'zzz-nothing-matches',
    })
    await render(container)

    expect(container.querySelector('.sidebar-empty')?.textContent).toContain('Nothing matches')
    expect(container.querySelectorAll('[data-testid="project-group"]').length).toBe(2)
    expect(emptyStateComesAfterGroups()).toBe(true)
  })

  it('renders the no-chats-yet line below the project groups too', async () => {
    useAppStore.setState({
      projects: PROJECTS,
      activeProjectId: 'p1',
      sessions: [],
      activeSessionId: null,
      query: '',
    })
    await render(container)

    expect(container.querySelector('.sidebar-empty')?.textContent).toContain('No chats yet')
    expect(emptyStateComesAfterGroups()).toBe(true)
  })

  it('still shows the empty state on a fresh install with no projects at all', async () => {
    useAppStore.setState({
      projects: [], activeProjectId: null, sessions: [], activeSessionId: null, query: '',
    })
    await render(container)

    expect(container.querySelector('.sidebar-empty')?.textContent).toContain('No chats yet')
    expect(container.querySelectorAll('[data-testid="project-group"]').length).toBe(0)
  })
})

describe('Sidebar keyboard: nested controls', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    installBridge()
    useAppStore.setState({
      projects: PROJECTS,
      activeProjectId: 'p1',
      sessions: [{ id: 's1', title: 'In Modelith', updatedAt: 3, projectId: 'p1' }],
      activeSessionId: null,
      query: '',
    } as never)
  })

  const bridge = () => (window as unknown as { modelith: {
    projects: { setActive: ReturnType<typeof vi.fn> }
    sessions: { load: ReturnType<typeof vi.fn> }
  } }).modelith

  const press = async (el: Element, key: string) => {
    await act(async () => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    })
  }

  // A row that is itself role="button" also sees the keydowns of every control
  // nested inside it. Handling them there calls preventDefault(), which cancels
  // the click the browser synthesizes for Enter/Space on a real button — so the
  // nested control does nothing and the row activates instead.
  it('does not activate the project when its collapse toggle is keyed', async () => {
    await render(container)
    bridge().projects.setActive.mockClear()
    const collapse = container.querySelector('[data-testid="project-collapse"]')!
    await press(collapse, ' ')
    expect(bridge().projects.setActive).not.toHaveBeenCalled()
  })

  it('does not activate the project when its remove button is keyed', async () => {
    await render(container)
    bridge().projects.setActive.mockClear()
    await press(container.querySelector('[data-testid="project-remove"]')!, 'Enter')
    expect(bridge().projects.setActive).not.toHaveBeenCalled()
  })

  it('does not open the session when its move-to-project dropdown is keyed', async () => {
    await render(container)
    bridge().sessions.load.mockClear()
    // Space is how a keyboard user opens a <select>. Swallowed here, the only
    // UI for filing a chat into a project is mouse-only.
    await press(container.querySelector('[data-testid="move-session"]')!, ' ')
    expect(bridge().sessions.load).not.toHaveBeenCalled()
  })
})
