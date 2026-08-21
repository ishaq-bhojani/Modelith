import { describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../src/renderer/state/store.js'

describe('stop()', () => {
  it('clears streamingText and locally appends an incomplete assistant message', async () => {
    const abort = vi.fn().mockResolvedValue(undefined)
    ;(globalThis as unknown as { window: unknown }).window = { modelith: { chat: { abort } } }
    useAppStore.setState({
      streamId: 'abc', streamingSessionId: 's1', activeSessionId: 's1',
      streamingText: 'partial reply', messages: [],
    })

    await useAppStore.getState().stop()

    const state = useAppStore.getState()
    expect(abort).toHaveBeenCalledWith('abc')
    expect(state.streamId).toBeNull()
    expect(state.streamingText).toBe('')
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]).toMatchObject({
      role: 'assistant', content: 'partial reply', incomplete: true,
    })
  })

  it('does not append when there is nothing streamed yet', async () => {
    const abort = vi.fn().mockResolvedValue(undefined)
    ;(globalThis as unknown as { window: unknown }).window = { modelith: { chat: { abort } } }
    useAppStore.setState({
      streamId: 'abc', streamingSessionId: 's1', activeSessionId: 's1',
      streamingText: '', messages: [],
    })

    await useAppStore.getState().stop()

    expect(useAppStore.getState().messages).toHaveLength(0)
  })
})

describe('applyEvent', () => {
  it("clears streamingText on the 'error' branch so a stale streaming bubble cannot linger", () => {
    useAppStore.setState({
      streamId: 'abc', lastStreamId: 'abc', streamingSessionId: 's1', activeSessionId: 's1',
      streamingText: 'partial', error: null,
    })
    useAppStore.getState().applyEvent({
      streamId: 'abc', sessionId: 's1',
      event: { type: 'error', error: { kind: 'network', message: 'boom' } },
    })
    expect(useAppStore.getState().streamingText).toBe('')
  })

  it('ignores a stray text delta that arrives after streamId has already been cleared (e.g. by stop())', () => {
    useAppStore.setState({
      streamId: null, lastStreamId: 'abc', streamingSessionId: 's1', activeSessionId: 's1',
      streamingText: '',
    })
    useAppStore.getState().applyEvent({
      streamId: 'abc', sessionId: 's1', event: { type: 'text', delta: 'ghost' },
    })
    expect(useAppStore.getState().streamingText).toBe('')
  })

  it('discards envelopes for a stream that is no longer current', () => {
    useAppStore.setState({
      streamId: 'other', lastStreamId: 'other', activeSessionId: 's1',
      streamingSessionId: 's1', streamingText: '',
    })
    useAppStore.getState().applyEvent({
      streamId: 'stale', sessionId: 's1', event: { type: 'text', delta: 'nope' },
    })
    expect(useAppStore.getState().streamingText).toBe('')
    expect(useAppStore.getState().streamId).toBe('other')
  })

  it('A to B to A mid-stream: switching away and back does not truncate the buffer', () => {
    // Start a stream owned by session A while A is the active (viewed)
    // session. `text` events must keep accumulating into the SAME buffer
    // regardless of which session the user is currently looking at — the
    // buffer is keyed by `streamingSessionId` (who owns the stream), not by
    // `activeSessionId` (what the user happens to be viewing).
    useAppStore.setState({
      streamId: 'stream-a', lastStreamId: 'stream-a',
      streamingSessionId: 'session-a', activeSessionId: 'session-a',
      streamingText: '', messages: [],
    })

    useAppStore.getState().applyEvent({
      streamId: 'stream-a', sessionId: 'session-a', event: { type: 'text', delta: 'one-' },
    })

    // User switches to session B mid-stream.
    useAppStore.setState({ activeSessionId: 'session-b' })
    useAppStore.getState().applyEvent({
      streamId: 'stream-a', sessionId: 'session-a', event: { type: 'text', delta: 'two-' },
    })

    // User switches back to session A before the stream finishes.
    useAppStore.setState({ activeSessionId: 'session-a' })
    useAppStore.getState().applyEvent({
      streamId: 'stream-a', sessionId: 'session-a', event: { type: 'text', delta: 'three' },
    })

    useAppStore.getState().applyEvent({
      streamId: 'stream-a', sessionId: 'session-a', event: { type: 'done' },
    })

    // The appended assistant message must contain ALL three deltas, not just
    // the one that arrived after the user returned to session A.
    const messages = useAppStore.getState().messages
    expect(messages).toHaveLength(1)
    expect(messages[0]?.content).toBe('one-two-three')
  })

  it('a stream finishing while the user is viewing a different session does not append to that session', () => {
    // Session A's stream is still running when the user switches to B.
    useAppStore.setState({
      streamId: 'stream-a', lastStreamId: 'stream-a',
      streamingSessionId: 'session-a', activeSessionId: 'session-b',
      streamingText: 'accumulated-in-a', messages: [],
    })

    useAppStore.getState().applyEvent({
      streamId: 'stream-a', sessionId: 'session-a', event: { type: 'done' },
    })

    // B's messages must be untouched — A's reply was persisted by main and
    // will be reloaded from disk when the user returns to A.
    expect(useAppStore.getState().messages).toEqual([])
  })

  it('accepts the second of two error envelopes for the same turn, replacing the first', () => {
    useAppStore.setState({
      streamId: 'abc', lastStreamId: 'abc', streamingSessionId: 's1', activeSessionId: 's1',
      streamingText: 'partial', error: null, messages: [],
    })

    // First error: provider failure. Clears `streamId` (no longer streaming)
    // but NOT `lastStreamId` (the turn is still identifiable).
    useAppStore.getState().applyEvent({
      streamId: 'abc', sessionId: 's1',
      event: { type: 'error', error: { kind: 'network', message: 'provider failed' } },
    })
    expect(useAppStore.getState().streamId).toBeNull()
    expect(useAppStore.getState().error?.message).toBe('provider failed')

    // Second error for the SAME turn (e.g. persisting the partial reply then
    // also failed). This is the more actionable message — the user needs to
    // know their reply was never saved — so it must win, not be dropped.
    expect(() => {
      useAppStore.getState().applyEvent({
        streamId: 'abc', sessionId: 's1',
        event: { type: 'error', error: { kind: 'unknown', message: 'failed to persist reply' } },
      })
    }).not.toThrow()

    expect(useAppStore.getState().error?.message).toBe('failed to persist reply')
    expect(useAppStore.getState().streamId).toBeNull()
  })
})

describe('trust-for-this-turn', () => {
  it('resolveEdit forwards trustTurn and sets the trusted banner', () => {
    const calls: unknown[] = []
    ;(globalThis as unknown as { window: unknown }).window = {
      modelith: { chat: { toolDecision: (...a: unknown[]) => { calls.push(a) } } },
    }
    useAppStore.setState({
      pendingEdit: { callId: 'c1', tool: 'write_file', relPath: 'a', previous: null, proposed: 'x' },
      trustedTurn: false,
    })
    useAppStore.getState().resolveEdit('accept', undefined, true)
    expect(calls[0]).toEqual(['c1', 'accept', undefined, true])
    expect(useAppStore.getState().trustedTurn).toBe(true)
  })

  it('resolveConfirm forwards trustTurn and sets the trusted banner', () => {
    const calls: unknown[] = []
    ;(globalThis as unknown as { window: unknown }).window = {
      modelith: { chat: { toolDecision: (...a: unknown[]) => { calls.push(a) } } },
    }
    useAppStore.setState({
      pendingConfirm: { callId: 'c2', name: 'run_command', argsJson: '{}' },
      trustedTurn: false,
    })
    useAppStore.getState().resolveConfirm('accept', false, true)
    expect(calls[0]).toEqual(['c2', 'accept', undefined, true])
    expect(useAppStore.getState().trustedTurn).toBe(true)
  })
})

describe('newSession()', () => {
  // Ruling (task-5-brief.md doesn't cover this): a new chat must land in the
  // active project immediately, so the e2e that clicks new-session and checks
  // the sidebar group without sending a message can pass. newSession() stamps
  // projectId itself, before loadSessions() reloads the sidebar.
  it('files a new chat under the active project before sessions reload', async () => {
    const calls: string[] = []
    const setProject = vi.fn().mockImplementation(async () => { calls.push('setProject') })
    const list = vi.fn().mockImplementation(async () => { calls.push('list'); return [] })
    ;(globalThis as unknown as { window: unknown }).window = {
      modelith: {
        sessions: {
          create: vi.fn().mockResolvedValue({ id: 's-new' }),
          setProject,
          list,
          load: vi.fn().mockResolvedValue([]),
        },
      },
    }
    useAppStore.setState({ activeProjectId: 'p1', sessions: [], activeSessionId: null, messages: [] })

    await useAppStore.getState().newSession()

    expect(setProject).toHaveBeenCalledWith('s-new', 'p1')
    // Must be filed BEFORE the sidebar reloads, or the new chat briefly (or
    // permanently, if the reload races ahead) shows up under Unfiled.
    expect(calls).toEqual(['setProject', 'list'])
  })

  it('leaves a new chat unfiled when there is no active project', async () => {
    const setProject = vi.fn()
    ;(globalThis as unknown as { window: unknown }).window = {
      modelith: {
        sessions: {
          create: vi.fn().mockResolvedValue({ id: 's-new' }),
          setProject,
          list: vi.fn().mockResolvedValue([]),
          load: vi.fn().mockResolvedValue([]),
        },
      },
    }
    useAppStore.setState({ activeProjectId: null, sessions: [], activeSessionId: null, messages: [] })

    await useAppStore.getState().newSession()

    expect(setProject).not.toHaveBeenCalled()
  })

  // Fix round 1, item 1: all four calls used to share one try/catch, so a
  // rejected setProject() left loadSessions()/selectSession() never called.
  // Main had already created the session — it's not lost from storage — but
  // the user saw an error banner and, on a fresh install, the empty "No
  // chats yet" state with no way to reach it. Clicking "New chat" again then
  // creates a second orphan instead of surfacing the first. A stamp failure
  // must degrade to "created, left Unfiled", not "created, unreachable".
  it('still loads sessions and selects the new one when filing it under the active project fails', async () => {
    const setProject = vi.fn().mockRejectedValue(new Error('disk full'))
    const list = vi.fn().mockResolvedValue([{ id: 's-new', title: 'New chat', updatedAt: 1 }])
    const load = vi.fn().mockResolvedValue([])
    ;(globalThis as unknown as { window: unknown }).window = {
      modelith: {
        sessions: {
          create: vi.fn().mockResolvedValue({ id: 's-new' }),
          setProject,
          list,
          load,
        },
      },
    }
    useAppStore.setState({ activeProjectId: 'p1', sessions: [], activeSessionId: null, messages: [], error: null })

    await useAppStore.getState().newSession()

    expect(setProject).toHaveBeenCalledWith('s-new', 'p1')
    expect(list).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith('s-new')
    expect(useAppStore.getState().activeSessionId).toBe('s-new')
    expect(useAppStore.getState().sessions).toEqual([{ id: 's-new', title: 'New chat', updatedAt: 1 }])
  })
})

// Fix round 1, item 2: sidebar-projects.test.ts drives loadProjects/
// createProject/renameProject/removeProject/setActiveProject/moveSession
// entirely through useAppStore.setState, so none of these bodies ever ran.
// These exercise the actions directly against a mocked bridge.
describe('project store actions', () => {
  const PROJECT_A = { id: 'p1', name: 'A', root: '/a', createdAt: 1, lastOpenedAt: 1 }
  const PROJECT_B = { id: 'p2', name: 'B', root: '/b', createdAt: 2, lastOpenedAt: 2 }

  function installBridge(overrides: {
    list?: ReturnType<typeof vi.fn>
    create?: ReturnType<typeof vi.fn>
    rename?: ReturnType<typeof vi.fn>
    remove?: ReturnType<typeof vi.fn>
    setActive?: ReturnType<typeof vi.fn>
    setProject?: ReturnType<typeof vi.fn>
    sessionsList?: ReturnType<typeof vi.fn>
  } = {}): void {
    ;(globalThis as unknown as { window: unknown }).window = {
      modelith: {
        projects: {
          list: overrides.list ?? vi.fn(),
          create: overrides.create ?? vi.fn(),
          rename: overrides.rename ?? vi.fn(),
          remove: overrides.remove ?? vi.fn(),
          setActive: overrides.setActive ?? vi.fn(),
        },
        sessions: {
          setProject: overrides.setProject ?? vi.fn().mockResolvedValue(undefined),
          list: overrides.sessionsList ?? vi.fn().mockResolvedValue([]),
        },
        workspace: { current: vi.fn().mockResolvedValue(null) },
      },
    }
  }

  it('loadProjects sets state from the bridge return value', async () => {
    const list = vi.fn().mockResolvedValue({ projects: [PROJECT_A], activeId: 'p1' })
    installBridge({ list })
    useAppStore.setState({ projects: [], activeProjectId: null })

    await useAppStore.getState().loadProjects()

    expect(useAppStore.getState().projects).toEqual([PROJECT_A])
    expect(useAppStore.getState().activeProjectId).toBe('p1')
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('createProject sets state from create()s return value, not a follow-up list() round trip', async () => {
    const list = vi.fn()
    const create = vi.fn().mockResolvedValue({ projects: [PROJECT_A, PROJECT_B], activeId: 'p2' })
    installBridge({ list, create })
    useAppStore.setState({ projects: [], activeProjectId: null })

    await useAppStore.getState().createProject()

    expect(useAppStore.getState().projects).toEqual([PROJECT_A, PROJECT_B])
    expect(useAppStore.getState().activeProjectId).toBe('p2')
    // Every projects.* method already returns the fresh { projects, activeId }
    // — a redundant list() call is a bug waiting to go stale.
    expect(list).not.toHaveBeenCalled()
  })

  it('renameProject sets state from rename()s return value, not a follow-up list() round trip', async () => {
    const list = vi.fn()
    const renamed = { ...PROJECT_A, name: 'Renamed' }
    const rename = vi.fn().mockResolvedValue({ projects: [renamed], activeId: 'p1' })
    installBridge({ list, rename })
    useAppStore.setState({ projects: [PROJECT_A], activeProjectId: 'p1' })

    await useAppStore.getState().renameProject('p1', 'Renamed')

    expect(rename).toHaveBeenCalledWith('p1', 'Renamed')
    expect(useAppStore.getState().projects).toEqual([renamed])
    expect(list).not.toHaveBeenCalled()
  })

  it('setActiveProject sets state from setActive()s return value, not a follow-up list() round trip', async () => {
    const list = vi.fn()
    const setActive = vi.fn().mockResolvedValue({ projects: [PROJECT_A, PROJECT_B], activeId: 'p2' })
    installBridge({ list, setActive })
    useAppStore.setState({ projects: [PROJECT_A, PROJECT_B], activeProjectId: 'p1' })

    await useAppStore.getState().setActiveProject('p2')

    expect(setActive).toHaveBeenCalledWith('p2')
    expect(useAppStore.getState().activeProjectId).toBe('p2')
    expect(list).not.toHaveBeenCalled()
  })

  it('removeProject sets state from the bridge return value and reloads sessions, so a removed group cannot keep showing sessions', async () => {
    const list = vi.fn()
    const remove = vi.fn().mockResolvedValue({ projects: [], activeId: null })
    const sessionsList = vi.fn().mockResolvedValue([{ id: 's1', title: 'Unfiled now', updatedAt: 1 }])
    installBridge({ list, remove, sessionsList })
    useAppStore.setState({ projects: [PROJECT_A], activeProjectId: 'p1', sessions: [] })

    await useAppStore.getState().removeProject('p1')

    expect(remove).toHaveBeenCalledWith('p1')
    expect(useAppStore.getState().projects).toEqual([])
    expect(list).not.toHaveBeenCalled()
    // The reload-after-mutate contract: without it the sidebar keeps
    // rendering sessions under a project group that no longer exists.
    expect(sessionsList).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().sessions).toEqual([{ id: 's1', title: 'Unfiled now', updatedAt: 1 }])
  })

  it('moveSession calls setProject then reloads sessions, so a moved session is not left showing under its old group', async () => {
    const setProject = vi.fn().mockResolvedValue(undefined)
    const sessionsList = vi.fn().mockResolvedValue([{ id: 's1', title: 'Moved', updatedAt: 1, projectId: 'p2' }])
    installBridge({ setProject, sessionsList })
    useAppStore.setState({ sessions: [{ id: 's1', title: 'Moved', updatedAt: 1, projectId: 'p1' }] })

    await useAppStore.getState().moveSession('s1', 'p2')

    expect(setProject).toHaveBeenCalledWith('s1', 'p2')
    expect(sessionsList).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().sessions).toEqual([{ id: 's1', title: 'Moved', updatedAt: 1, projectId: 'p2' }])
  })

  // Fix round 1, item 4: "Open folder" resolves an id to a root in main and
  // opens it — the store action is a thin, id-only pass-through.
  it('openProjectFolder passes only the id to the bridge, never a path', async () => {
    const openFolder = vi.fn().mockResolvedValue(undefined)
    ;(globalThis as unknown as { window: unknown }).window = {
      modelith: { projects: { openFolder } },
    }

    await useAppStore.getState().openProjectFolder('p1')

    expect(openFolder).toHaveBeenCalledWith('p1')
  })

  it('openProjectFolder surfaces a bridge failure through the shared error field', async () => {
    const openFolder = vi.fn().mockRejectedValue(new Error('boom'))
    ;(globalThis as unknown as { window: unknown }).window = {
      modelith: { projects: { openFolder } },
    }
    useAppStore.setState({ error: null })

    await useAppStore.getState().openProjectFolder('p1')

    expect(useAppStore.getState().error?.message).toContain('boom')
  })
})
