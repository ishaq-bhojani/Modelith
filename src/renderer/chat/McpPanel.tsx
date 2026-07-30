import { useState } from 'react'
import { useAppStore } from '../state/store.js'

/**
 * The MCP servers browser (mcp-client spec §2). Add stdio servers by command,
 * see their connection status and discovered tools, and enable/remove them.
 * A superset of hand-editing a JSON config. All process management is in main;
 * this panel only sends config.
 */
export function McpPanel(): React.JSX.Element | null {
  const open = useAppStore((s) => s.mcpOpen)
  const toggle = useAppStore((s) => s.toggleMcp)
  const servers = useAppStore((s) => s.mcpServers)
  const addServer = useAppStore((s) => s.addMcpServer)
  const removeServer = useAppStore((s) => s.removeMcpServer)
  const setEnabled = useAppStore((s) => s.setMcpEnabled)

  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')

  if (!open) return null

  const submit = () => {
    const trimmed = command.trim()
    if (!trimmed) return
    const id = `${name.trim() || trimmed}-${Date.now()}`.replace(/[^a-zA-Z0-9_-]/g, '_')
    void addServer({ id, name: name.trim() || trimmed, command: trimmed, args: args.trim() ? args.trim().split(/\s+/) : [] })
    setName(''); setCommand(''); setArgs('')
  }

  return (
    <aside className="workspace" data-testid="mcp-panel" aria-label="MCP servers">
      <div className="inspector-head">
        <span className="inspector-title">MCP servers</span>
        <button className="icon-button" aria-label="Close MCP" onClick={toggle}>✕</button>
      </div>

      <div className="workspace-list">
        {servers.length === 0 ? (
          <p className="inspector-empty">No servers yet.</p>
        ) : (
          servers.map((s) => (
            <div key={s.id} className="mcp-server" data-testid="mcp-server">
              <div className="mcp-server-row">
                <span className={`mcp-dot${s.connected ? ' mcp-dot-on' : ''}`} />
                <span className="mcp-server-name">{s.name}</span>
                <label className="mcp-toggle">
                  <input type="checkbox" checked={s.enabled} onChange={(e) => void setEnabled(s.id, e.target.checked)} />
                  on
                </label>
                <button className="ghost-button" data-testid="mcp-remove" onClick={() => void removeServer(s.id)}>Remove</button>
              </div>
              {s.error ? <div className="mcp-error">{s.error}</div> : null}
              {s.tools.length > 0 ? (
                <div className="mcp-tools">{s.tools.map((t) => <code key={t.name}>{t.name}</code>)}</div>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="mcp-add">
        <input className="mcp-input" data-testid="mcp-name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="mcp-input" data-testid="mcp-command" placeholder="Command (e.g. node)" value={command} onChange={(e) => setCommand(e.target.value)} />
        <input className="mcp-input" data-testid="mcp-args" placeholder="Arguments (space-separated)" value={args} onChange={(e) => setArgs(e.target.value)} />
        <button className="send-button mcp-add-btn" data-testid="mcp-add" disabled={!command.trim()} onClick={submit}>Add server</button>
      </div>
    </aside>
  )
}
