import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { splitLines } from './line-buffer.js'

/** One tool a server advertises via `tools/list`. */
export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface McpServerConfig {
  id: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

interface Pending { resolve: (value: unknown) => void; reject: (err: Error) => void }

/**
 * A minimal Model Context Protocol client over stdio (spec §1). Speaks
 * newline-delimited JSON-RPC 2.0 to a spawned child: initialize → initialized →
 * tools/list / tools/call. Deliberately small — just what the tool loop needs.
 * All process management lives here in main; the renderer never spawns anything.
 */
export class McpClient {
  private child: ChildProcessWithoutNullStreams | undefined
  private carry = ''
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private connected = false

  constructor(private readonly config: McpServerConfig) {}

  get id(): string { return this.config.id }
  get isConnected(): boolean { return this.connected }

  async connect(): Promise<McpToolInfo[]> {
    this.child = spawn(this.config.command, this.config.args ?? [], {
      env: { ...process.env, ...(this.config.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => this.onData(chunk))
    this.child.on('error', () => this.failAll(new Error('MCP server process error')))
    this.child.on('exit', () => { this.connected = false; this.failAll(new Error('MCP server exited')) })

    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'open-coder', version: '0.0.1' },
    })
    this.notify('notifications/initialized', {})
    this.connected = true
    return this.listTools()
  }

  async listTools(): Promise<McpToolInfo[]> {
    const res = (await this.request('tools/list', {})) as { tools?: McpToolInfo[] }
    return res.tools ?? []
  }

  /** Call a tool; returns its result text (spec §3). */
  async callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const res = (await this.request('tools/call', { name, arguments: args })) as {
      content?: { type?: string; text?: string }[]
      isError?: boolean
    }
    const text = (res.content ?? []).map((c) => c.text ?? '').join('\n')
    return { text, isError: res.isError === true }
  }

  dispose(): void {
    this.connected = false
    this.failAll(new Error('MCP client disposed'))
    this.child?.kill()
    this.child = undefined
  }

  private onData(chunk: string): void {
    const { lines, carry } = splitLines(this.carry, chunk)
    this.carry = carry
    for (const line of lines) {
      let msg: { id?: number; result?: unknown; error?: { message?: string } }
      try { msg = JSON.parse(line) } catch { continue }
      if (typeof msg.id !== 'number') continue // a notification/log from the server
      const pending = this.pending.get(msg.id)
      if (!pending) continue
      this.pending.delete(msg.id)
      if (msg.error) pending.reject(new Error(msg.error.message ?? 'MCP error'))
      else pending.resolve(msg.result)
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.child) return Promise.reject(new Error('MCP server not started'))
    const id = this.nextId++
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child!.stdin.write(payload)
    })
  }

  private notify(method: string, params: unknown): void {
    this.child?.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) p.reject(err)
    this.pending.clear()
  }
}
