import { describe, it, expect, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { McpClient } from '../../src/main/mcp/client.js'

const server = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'mcp-server.mjs')

let client: McpClient | undefined
afterEach(() => { client?.dispose(); client = undefined })

describe('McpClient (stdio, against a real fake server)', () => {
  it('connects, initialises, and lists tools', async () => {
    client = new McpClient({ id: 's1', name: 'fake', command: process.execPath, args: [server] })
    const tools = await client.connect()
    expect(tools.map((t) => t.name)).toEqual(['echo'])
    expect(client.isConnected).toBe(true)
  })

  it('calls a tool and returns its result text', async () => {
    client = new McpClient({ id: 's1', name: 'fake', command: process.execPath, args: [server] })
    await client.connect()
    const out = await client.callTool('echo', { text: 'hi' })
    expect(out).toEqual({ text: 'echo: hi', isError: false })
  })
})
