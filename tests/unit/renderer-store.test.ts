import { describe, expect, it } from 'vitest'
import { useAppStore } from '../../src/renderer/state/store.js'

describe('applyEvent', () => {
  it('discards envelopes for a stream that is no longer current', () => {
    useAppStore.setState({ streamId: 'other', streamingText: '' })
    useAppStore.getState().applyEvent({
      streamId: 'stale', sessionId: 's1', event: { type: 'text', delta: 'nope' },
    })
    expect(useAppStore.getState().streamingText).toBe('')
    expect(useAppStore.getState().streamId).toBe('other')
  })

  it('tolerates a second error envelope for the same turn without throwing or corrupting state', () => {
    useAppStore.setState({ streamId: 'abc', streamingText: 'partial', error: null })

    // First error: provider failure. This clears streamId to null per the
    // terminal-error contract.
    useAppStore.getState().applyEvent({
      streamId: 'abc', sessionId: 's1',
      event: { type: 'error', error: { kind: 'network', message: 'boom' } },
    })
    expect(useAppStore.getState().streamId).toBeNull()
    expect(useAppStore.getState().error?.message).toBe('boom')

    // Second error for the SAME original stream (e.g. persistence failure
    // after the provider already failed). Must not throw, and since streamId
    // is already null, this late envelope no longer matches the current
    // stream and is safely discarded rather than overwriting the first error.
    expect(() => {
      useAppStore.getState().applyEvent({
        streamId: 'abc', sessionId: 's1',
        event: { type: 'error', error: { kind: 'unknown', message: 'second failure' } },
      })
    }).not.toThrow()

    expect(useAppStore.getState().error?.message).toBe('boom')
    expect(useAppStore.getState().streamId).toBeNull()
  })
})
