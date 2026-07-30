import { useAppStore } from '../state/store.js'

/**
 * The Model Race columns (model-race spec §4): 2–4 models answering the same
 * prompt in parallel, each with a Pick button. Picking persists that reply as
 * the turn's answer and collapses the race; the losers are discarded.
 */
export function RaceView(): React.JSX.Element | null {
  const race = useAppStore((s) => s.race)
  const choose = useAppStore((s) => s.chooseWinner)
  const cancel = useAppStore((s) => s.abortRace)

  if (!race) return null

  return (
    <section className="race" data-testid="race-view">
      <div className="race-head">
        <span className="race-title">Model race · {race.columns.length} models</span>
        <button className="ghost-button" data-testid="race-cancel" onClick={() => void cancel()}>Cancel</button>
      </div>
      <div className="race-columns">
        {race.columns.map((c) => (
          <div key={c.columnId} className="race-col" data-testid="race-col">
            <div className="race-col-head">
              <span className="race-col-model" title={`${c.providerId} · ${c.model}`}>{c.model}</span>
              <button
                className="chip-button"
                data-testid="race-pick"
                disabled={!c.done || c.error !== null || c.text.trim() === ''}
                onClick={() => void choose(c.columnId)}
              >
                Pick
              </button>
            </div>
            <div className="race-col-body">
              {c.error ? <div className="race-col-error">{c.error}</div> : <pre className="race-col-text">{c.text || '…'}</pre>}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
