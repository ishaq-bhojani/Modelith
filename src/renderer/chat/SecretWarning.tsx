import { useAppStore } from '../state/store.js'
import { IconWarning } from '../app/icons.js'
import type { SecretCategory } from '@shared/secret-scan'

const LABEL: Record<SecretCategory, string> = {
  'api-key': 'an API key',
  'aws-key': 'an AWS access key',
  'private-key': 'a private key',
  'env-secret': 'a secret in a .env-style assignment',
}

/**
 * The outbound-secret gate (roadmap 28). Opened when the draft looks like it
 * contains credentials; the user decides whether to send anyway. This is a
 * speed bump against the common paste-a-key accident, not a hard block.
 */
export function SecretWarning(): React.JSX.Element | null {
  const categories = useAppStore((s) => s.pendingSecret)
  const confirm = useAppStore((s) => s.confirmSecretSend)
  const cancel = useAppStore((s) => s.cancelSecretSend)

  if (!categories) return null

  return (
    <div className="dialog-backdrop" role="dialog" aria-label="Possible secret" aria-modal="true">
      <div className="dialog secret-dialog">
        <div className="secret-head">
          <span className="secret-icon"><IconWarning size={18} /></span>
          <h2>This message may contain a secret</h2>
        </div>
        <p className="field-hint">
          It looks like your message includes {categories.map((c) => LABEL[c]).join(', ')}. Anything
          you send leaves this machine and goes to the provider. Send it anyway?
        </p>
        <div className="dialog-actions">
          <span className="dialog-spacer" />
          <button className="button-secondary" data-testid="secret-cancel" onClick={cancel}>
            Cancel
          </button>
          <button className="button-compact" data-testid="secret-send-anyway" onClick={confirm}>
            Send anyway
          </button>
        </div>
      </div>
    </div>
  )
}
