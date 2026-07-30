import type { DataPolicy } from '@shared/types'

/**
 * States plainly how a provider handles inputs, so a user knows before pasting
 * proprietary code. Three cases: local (no egress at all), private (does not
 * train on inputs), and trains-on-input (the one to be cautious about).
 */
export function DataPolicyBadge({ policy }: { policy: DataPolicy }): React.JSX.Element {
  if (policy.local) {
    return <span className="policy-badge policy-local">Local · no egress</span>
  }
  if (policy.trainsOnInput) {
    return (
      <span className="policy-badge policy-warn" title="This provider may train on your inputs.">
        May train on inputs
      </span>
    )
  }
  return <span className="policy-badge policy-ok">Doesn’t train on inputs</span>
}
