import { useAppStore } from '../../state/store.js'

/**
 * Named presets. The tallest panel — the only one expected to scroll.
 * `modeName` and `modePrompt` are owned by the shell (SettingsDialog) so a
 * hand-typed mode name and system prompt survive switching category and
 * back — unmounting this panel would otherwise discard user-authored prose
 * silently, with no warning and no undo.
 */
export function ModesPanel({
  modeName, setModeName, modePrompt, setModePrompt,
}: {
  modeName: string
  setModeName: (v: string) => void
  modePrompt: string
  setModePrompt: (v: string) => void
}): React.JSX.Element {
  const providerId = useAppStore((s) => s.providerId)
  const model = useAppStore((s) => s.model)
  const modes = useAppStore((s) => s.modes)
  const saveMode = useAppStore((s) => s.saveMode)
  const deleteMode = useAppStore((s) => s.deleteMode)

  return (
    <div className="field">
      <label>Modes</label>
      <p className="field-hint">
        Named presets. Applying one (from the composer) sets its system prompt and the
        current model for following turns.
      </p>
      {modes.length > 0 ? (
        <ul className="mode-list">
          {modes.map((m) => (
            <li key={m.id} className="mode-list-item">
              <span className="mode-list-name">{m.name}</span>
              <button
                className="row-action row-action-danger"
                data-testid="delete-mode"
                aria-label={`Delete mode ${m.name}`}
                onClick={() => void deleteMode(m.id)}
              >✕</button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        data-testid="mode-name"
        placeholder="Mode name (e.g. Rust reviewer)"
        value={modeName}
        onChange={(e) => setModeName(e.target.value)}
      />
      <textarea
        className="mode-prompt"
        data-testid="mode-prompt"
        placeholder="System prompt"
        rows={3}
        value={modePrompt}
        onChange={(e) => setModePrompt(e.target.value)}
      />
      <button
        className="button-secondary"
        data-testid="mode-save"
        disabled={modeName.trim() === '' || modePrompt.trim() === ''}
        onClick={() => {
          void saveMode({
            id: `mode-${Date.now()}`,
            name: modeName.trim(),
            systemPrompt: modePrompt.trim(),
            providerId,
            model,
          })
          setModeName('')
          setModePrompt('')
        }}
      >
        Add mode (uses the current provider &amp; model)
      </button>
    </div>
  )
}
