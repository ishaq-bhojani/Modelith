import { describe, expect, it } from 'vitest'
import { useAppStore } from '../../src/renderer/state/store.js'

describe('applyEvent', () => {
  it('discards envelopes for a stream that is no longer current', () => {
    useAppStore.setState({
      streamId: 'other', lastStreamId: 'other', activeSessionId: 's1', streamingText: '',
    })
    useAppStore.getState().applyEvent({
      streamId: 'stale', sessionId: 's1', event: { type: 'text', delta: 'nope' },
    })
    expect(useAppStore.getState().streamingText).toBe('')
    expect(useAppStore.getState().streamId).toBe('other')
  })

  it('discards envelopes for a session that is no longer the active one', () => {
    // Same streamId/lastStreamId (the turn is still "current" by stream
    // identity) but the user has switched to a different session in the
    // sidebar. Session A's stream events must not bleed into session B.
    useAppStore.setState({
      streamId: 'abc', lastStreamId: 'abc', activeSessionId: 'session-b',
      streamingText: '', messages: [],
    })
    useAppStore.getState().applyEvent({
      streamId: 'abc', sessionId: 'session-a', event: { type: 'text', delta: 'leaked' },
    })
    expect(useAppStore.getState().streamingText).toBe('')

    useAppStore.getState().applyEvent({
      streamId: 'abc', sessionId: 'session-a',
      event: { type: 'done' },
    })
    // The done event must not append session A's reply into session B's messages.
    expect(useAppStore.getState().messages).toEqual([])
  })

  it('accepts the second of two error envelopes for the same turn, replacing the first', () => {
    useAppStore.setState({
      streamId: 'abc', lastStreamId: 'abc', activeSessionId: 's1',
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
