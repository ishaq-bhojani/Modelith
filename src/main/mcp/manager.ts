import { McpClient, type McpServerConfig, type McpToolInfo } from './client.js'
import type { AppSettingsStore } from '../settings/store.js'
import type { McpServerStatus, ToolSpec } from '../../shared/types.js'

/** Persisted server config plus an enabled flag (mcp-client spec §2). */
export interface StoredMcpServer extends McpServerConfig { enabled: boolean }

const PREFIX = 'mcp__'
/** Namespaced tool name so servers can't collide and the engine can route. */
export function namespacedToolName(serverId: string, tool: string): string {
  return `${PREFIX}${serverId}__${tool}`
}
/** Parse a namespaced name back into { serverId, tool }, or null if not MCP. */
export function parseToolName(name: string): { serverId: string; tool: string } | null {
  if (!name.startsWith(PREFIX)) return null
  const rest = name.slice(PREFIX.length)
  const sep = rest.indexOf('__')
  if (sep === -1) return null
  return { serverId: rest.slice(0, sep), tool: rest.slice(sep + 2) }
}

interface Entry { config: StoredMcpServer; client?: McpClient; tools: McpToolInfo[]; error?: string }

/**
 * Manages configured MCP servers (spec §2–3): persistence, connection, tool
 * aggregation for the agent loop, and routing a namespaced call to the owning
 * server. All process management is here in main.
 */
export class McpManager {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly settings: AppSettingsStore) {}

  /** Load configured servers from settings and connect the enabled ones. */
  async init(): Promise<void> {
    const stored = await this.readConfig()
    for (const config of stored) this.entries.set(config.id, { config, tools: [] })
    await Promise.all(stored.filter((s) => s.enabled).map((s) => this.connect(s.id)))
  }

  private async readConfig(): Promise<StoredMcpServer[]> {
    const raw = (await this.settings.get())['mcpServers']
    return Array.isArray(raw) ? (raw as StoredMcpServer[]) : []
  }

  private async writeConfig(): Promise<void> {
    await this.settings.set({ mcpServers: [...this.entries.values()].map((e) => e.config) })
  }

  async connect(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.client?.dispose()
    const client = new McpClient(entry.config)
    try {
      entry.tools = await client.connect()
      entry.client = client
      delete entry.error
    } catch (err) {
      entry.client = undefined
      entry.tools = []
      entry.error = err instanceof Error ? err.message : String(err)
    }
  }

  async addServer(config: Omit<StoredMcpServer, 'enabled'> & { enabled?: boolean }): Promise<void> {
    const full: StoredMcpServer = { ...config, enabled: config.enabled ?? true }
    this.entries.set(full.id, { config: full, tools: [] })
    await this.writeConfig()
    if (full.enabled) await this.connect(full.id)
  }

  async removeServer(id: string): Promise<void> {
    this.entries.get(id)?.client?.dispose()
    this.entries.delete(id)
    await this.writeConfig()
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.config.enabled = enabled
    await this.writeConfig()
    if (enabled) await this.connect(id)
    else { entry.client?.dispose(); entry.client = undefined; entry.tools = [] }
  }

  /** Status for the servers panel. */
  list(): McpServerStatus[] {
    return [...this.entries.values()].map((e) => ({
      id: e.config.id,
      name: e.config.name,
      enabled: e.config.enabled,
      connected: e.client?.isConnected ?? false,
      ...(e.error ? { error: e.error } : {}),
      tools: e.tools.map((t) => ({ name: t.name, ...(t.description ? { description: t.description } : {}) })),
    }))
  }

  /** Aggregated, namespaced tool specs for connected servers (spec §3). */
  toolSpecs(): ToolSpec[] {
    const specs: ToolSpec[] = []
    for (const entry of this.entries.values()) {
      if (!entry.client?.isConnected) continue
      for (const tool of entry.tools) {
        specs.push({
          name: namespacedToolName(entry.config.id, tool.name),
          description: tool.description ?? `Tool ${tool.name} from ${entry.config.name}`,
          parameters: tool.inputSchema ?? { type: 'object', properties: {} },
        })
      }
    }
    return specs
  }

  /** Route a namespaced tool call to its server (spec §3). */
  async call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const parsed = parseToolName(name)
    if (!parsed) return { text: `Not an MCP tool: ${name}`, isError: true }
    const entry = this.entries.get(parsed.serverId)
    if (!entry?.client?.isConnected) return { text: `MCP server ${parsed.serverId} is not connected.`, isError: true }
    try {
      return await entry.client.callTool(parsed.tool, args)
    } catch (err) {
      return { text: err instanceof Error ? err.message : String(err), isError: true }
    }
  }

  dispose(): void {
    for (const e of this.entries.values()) e.client?.dispose()
  }
}
