import { describe, expect, it } from 'vitest'
import { ErrorNotice } from '../../src/renderer/chat/ErrorNotice.js'
import type { ErrorKind, ProviderError } from '../../src/shared/types.js'

// The oracle for this test. Deliberately typed as `Record<ErrorKind, ...>` so
// that adding a new ErrorKind without updating this map is a compile error
// here too — mirroring the exhaustiveness guarantee ErrorNotice.tsx's own
// `ACTION_LABEL` record already provides, but from the test side.
const EXPECTED_LABEL: Record<ErrorKind, string | null> = {
  auth: 'Open settings',
  rate_limit: 'Retry',
  context_overflow: 'Retry with fewer messages',
  network: 'Retry',
  provider_5xx: 'Retry',
  busy: 'Retry',
  no_model: 'Open settings',
  unknown: 'Retry',
}

interface ElementLike {
  props?: { 'data-testid'?: string; children?: unknown }
}

/**
 * Finds a node by test id anywhere in the returned element tree.
 *
 * Deliberately structure-agnostic: an earlier version of this test indexed
 * into `children[2]`, which coupled it to ErrorNotice's exact JSX shape and
 * broke the moment the markup was restyled — even though the mapping under
 * test was unchanged. The behaviour being verified is "this kind renders this
 * action label", not "the button is the third child".
 */
function findByTestId(node: unknown, testId: string): ElementLike | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByTestId(child, testId)
      if (hit) return hit
    }
    return null
  }
  if (typeof node !== 'object' || node === null) return null
  const element = node as ElementLike
  if (element.props?.['data-testid'] === testId) return element
  return element.props ? findByTestId(element.props.children, testId) : null
}

describe('ErrorNotice action label mapping', () => {
  for (const [kind, expectedLabel] of Object.entries(EXPECTED_LABEL) as [ErrorKind, string | null][]) {
    it(`renders '${kind}' with action ${expectedLabel === null ? '(none)' : `"${expectedLabel}"`}`, () => {
      const error: ProviderError = { kind, message: 'test message' }
      // ErrorNotice has no hooks, so calling it directly as a plain function
      // (rather than through a renderer) returns the React element tree
      // exactly as JSX built it — no DOM/jsdom needed to inspect it.
      const element = ErrorNotice({ error, onAction: () => {} })

      if (expectedLabel === null) {
        expect(element).toBeNull()
        return
      }

      expect(element).not.toBeNull()
      const button = findByTestId(element, 'error-action')
      expect(button).not.toBeNull()
      expect(button?.props?.children).toBe(expectedLabel)
    })
  }
})
