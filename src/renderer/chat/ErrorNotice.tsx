import type { ProviderError } from '@shared/types'

const ACTION_LABEL: Record<ProviderError['kind'], string | null> = {
  auth: 'Open settings',
  rate_limit: 'Retry',
  context_overflow: 'Retry with fewer messages',
  network: 'Retry',
  provider_5xx: 'Retry',
  aborted: null,
  busy: 'Retry',
  no_model: 'Open settings',
  unknown: 'Retry',
}

interface Props { error: ProviderError; onAction(kind: ProviderError['kind']): void }

export function ErrorNotice({ error, onAction }: Props): React.JSX.Element | null {
  const label = ACTION_LABEL[error.kind]
  if (error.kind === 'aborted') return null
  return (
    <div data-testid="error-notice" className="error-notice" role="alert">
      <span>{error.message}</span>
      {error.retryAfterSeconds ? <span> Try again in {error.retryAfterSeconds}s.</span> : null}
      {label ? (
        <button data-testid="error-action" onClick={() => onAction(error.kind)}>{label}</button>
      ) : null}
    </div>
  )
}
