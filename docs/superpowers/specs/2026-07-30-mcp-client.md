# Spec: MCP client + server browser (parity sub-project #4)

**Status:** APPROVED (proceed autonomously; no new privileged surface).
**Depends on:** the tool-calling loop from #3 (agentic edits, merged).
**Roadmap:** Claude Desktop parity for connectors, plus a UI to add servers.

Connect Model Context Protocol servers, discover their tools, and expose those
tools to the agent through the loop already built. Tool calls flow through the
existing engine turn; MCP tool calls are **gated** (approved per call) because a
server's tool can have arbitrary side effects.

## 1. Transport (v1)
- **stdio** servers only in v1 (the dominant local config: a `command` + `args`,
  optional `env`). HTTP/SSE transport is a later addition.
- JSON-RPC 2.0, **newline-delimited** over the child's stdin/stdout. Requests
  are matched to responses by `id`; the child's stderr is captured for
  diagnostics, never shown as a tool result.
- Lifecycle: `initialize` → `notifications/initialized` → `tools/list`. Tools are
  re-listable. A crashed/again server surfaces as disconnected, not a hang.

## 2. Configuration
- Servers are stored in the settings store under `mcpServers`:
  `{ id, name, command, args[], env? , enabled }`. No secrets beyond what the
  user types into `env` (kept in settings, not the keychain — documented).
- A **Servers panel** (drawer) lists configured servers with status
  (connected / error), their discovered tools, and add/remove/enable controls.
  This is the "superset" over hand-editing JSON that the roadmap calls for.

## 3. Tool integration
- Each MCP tool is advertised to the provider as a `ToolSpec` named
  `mcp__<serverId>__<tool>` (namespaced so two servers can't collide and the
  engine can route by prefix). Its `parameters` is the server's `inputSchema`.
- MCP tools are offered only in **Agent mode** (same opt-in as edit tools), and
  only for connected servers.
- The engine routes an `mcp__…` tool call to the owning server's `tools/call`.
  **Every MCP call is gated** by a generic approval (server, tool, arguments) —
  Accept / Reject, plus "allow this tool for the session" to avoid nagging on a
  repeated read. Rejection returns a tool result saying so; the model adapts.
- Confinement/safety of what a server does is the server's own concern; the app
  guarantees the user *approved the call*, and never auto-runs an MCP tool.

## 4. Security invariants
- No MCP tool runs without approval (per call, or a session allow the user set).
- Servers are spawned only from user-entered config; nothing auto-installs.
- The renderer never spawns processes — all child management is in main.
- No key to renderer unchanged; MCP `env` values live in settings, never sent to
  the renderer after being set (write-only from the panel, like API keys).
- Executable tests prove: a configured fake stdio server connects and lists its
  tool; an approved call returns the server's result; a rejected call does not
  invoke the server; a namespaced call routes to the right server.

## 5. Decisions (chosen)
- stdio only in v1 (HTTP/SSE later).
- MCP calls gated by default, with an optional per-session allow-list the user
  opts into per tool (never a blanket auto-approve).
- `env` stored in settings (not keychain) for v1, clearly labelled.

## 6. Definition of done
MCP servers can be added in the UI and their tools called in a turn (the plan's
DoD item for #4), each call approved, routed to the right server, and proved by
tests — shipped through the review loop.
