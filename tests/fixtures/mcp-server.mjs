// A minimal MCP-over-stdio server for tests: newline-delimited JSON-RPC 2.0.
// Implements initialize, tools/list, and tools/call for one echo tool.
import readline from 'node:readline'

const rl = readline.createInterface({ input: process.stdin })

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n') }

rl.on('line', (line) => {
  let req
  try { req = JSON.parse(line) } catch { return }
  if (req.method === 'notifications/initialized') return // notification, no reply
  if (req.method === 'initialize') {
    send({ jsonrpc: '2.0', id: req.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake-mcp', version: '1.0.0' } } })
    return
  }
  if (req.method === 'tools/list') {
    send({
      jsonrpc: '2.0', id: req.id, result: {
        tools: [{ name: 'echo', description: 'Echo back the text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }],
      },
    })
    return
  }
  if (req.method === 'tools/call') {
    const text = req.params?.arguments?.text ?? ''
    send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: `echo: ${text}` }] } })
    return
  }
  send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'Method not found' } })
})
