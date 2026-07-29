import { describe, expect, it } from 'vitest'
import { useAppStore } from '../../src/renderer/state/store.js'

describe('applyEvent', () => {
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
