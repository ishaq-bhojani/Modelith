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
      // Children, per ErrorNotice.tsx's JSX: [<span>message</span>, retry-span-or-null, button-or-null].
      const children = element?.props.children as unknown[]
      const button = children[2] as { props: { 'data-testid': string; children: string } } | null
      expect(button).not.toBeNull()
      expect(button?.props['data-testid']).toBe('error-action')
      expect(button?.props.children).toBe(expectedLabel)
    })
  }
})
