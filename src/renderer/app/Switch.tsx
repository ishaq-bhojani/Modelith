/**
 * A real toggle.
 *
 * Replaces a raw `<input type="checkbox">` that was wrapped in `.key-status` —
 * a class whose other job is rendering the "Configured" status readout on the
 * Provider panel. One class doing both meant neither could be styled without
 * disturbing the other.
 *
 * `role="switch"` + `aria-checked` is the accessible equivalent of the checkbox
 * it replaces; keeping it a real <button> keeps it keyboard reachable and
 * space/enter activated for free.
 */
export function Switch({
  checked, onChange, label, testId,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  testId?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? ' is-on' : ''}`}
      {...(testId ? { 'data-testid': testId } : {})}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  )
}
