/**
 * The title and description at the top of every settings panel.
 *
 * Before this, each panel was a single `.field`, so its `<label>` — a 10.5px
 * uppercase micro-label meant to name one input — was doing the job of a panel
 * title. "Updates" and "API key" were set identically. This puts the panel name
 * in the display face and gives the micro-label its one job back.
 */
export function PanelHead({
  title, children,
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="panel-head">
      <h4>{title}</h4>
      <p>{children}</p>
    </div>
  )
}
