import type { ProviderError } from '@shared/types'

const ACTION_LABEL: Record<ProviderError['kind'], string | null> = {
  auth: 'Open settings',
  rate_limit: 'Retry',
  context_overflow: 'Retry with fewer messages',
  network: 'Retry',
  provider_5xx: 'Retry',
  busy: 'Retry',
  no_model: 'Open settings',
  unknown: 'Retry',
}

/**
 * Human-readable heading per kind. The design gives each error a short
 * uppercase label above the message so the taxonomy is visible at a glance —
 * spec §7.4: raw stack traces never reach a bubble.
 */
const KIND_LABEL: Record<ProviderError['kind'], string> = {
  auth: 'Authentication',
  rate_limit: 'Rate limited',
  context_overflow: 'Conversation too long',
  network: 'Network',
  provider_5xx: 'Provider unavailable',
  busy: 'Already streaming',
  no_model: 'No model selected',
  unknown: 'Something went wrong',
}

interface Props { error: ProviderError; onAction(kind: ProviderError['kind']): void }

export function ErrorNotice({ error, onAction }: Props): React.JSX.Element | null {
  const label = ACTION_LABEL[error.kind]
  return (
    <div data-testid="error-notice" className="error-notice" role="alert">
      <span className="error-text">
        <span className="error-kind">{KIND_LABEL[error.kind]}</span>
        {error.message}
        {error.retryAfterSeconds ? ` Try again in ${error.retryAfterSeconds}s.` : null}
      </span>
      {label ? (
        <button className="error-action" data-testid="error-action" onClick={() => onAction(error.kind)}>
          {label}
        </button>
      ) : null}
    </div>
  )
}
