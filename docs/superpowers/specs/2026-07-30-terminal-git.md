# Spec: Terminal + git awareness (parity sub-project #5)

**Status:** APPROVED. Decisions: A = per-command gate + user-defined session
allow-prefixes; B = read-only git tools + Git panel + gated commit; C = real
platform shell (`sh -c` / `cmd /c`), approval as the guard.
**Depends on:** the tool loop + approval gate (#3), workspace root (#2).
**Roadmap:** the depth Aider/Warp users rely on — run commands, see git state.

This is the **most dangerous surface**: arbitrary command execution. The rule is
stricter than #3's: a command runs only after explicit human approval (or a rule
the human themselves created), always in the workspace root, with a timeout and
an output cap, killed on abort.

## 1. Command execution
- A `run_command(command)` tool in the agent loop. Every call is **gated** — the
  card shows the exact command and its cwd (the workspace root), with
  **Run · Reject**, and an opt-in **"Always allow commands starting with …"**
  that the user themselves defines (never a blanket auto-approve the model can
  trigger).
- Execution: spawned via the platform shell (`sh -c` / `cmd /c`) with
  `cwd = workspace root` and inherited env (real tools like `npm`/`git` need
  PATH). stdout+stderr stream to the renderer live and are captured (truncated
  to a cap, e.g. 100 KB) as the tool result fed back to the model.
- Bounds: a wall-clock timeout (e.g. 120 s), an output cap, and **kill on abort**
  (Stop ends the child). No background/daemon processes survive a turn.
- Confinement note: unlike file reads, a shell can `cd` elsewhere — confinement
  here is *approval*, not a path sandbox. The cwd defaults to the root; the user
  sees the command before it runs and is the gate.

## 2. Git awareness
- Read-only git tools **auto-run** (like `read_file`): `git_status`, `git_diff`
  (optionally per-path), `git_log` — implemented by running the git binary in the
  root, parsed to text for the model. Auto-run is safe (read-only) and confined
  to reporting.
- A **Git panel** (drawer) shows branch, staged/unstaged files, and a diff view,
  refreshed on demand — the visible git state Cursor/Aider users expect.
- **Commit** is an explicit action: a gated `git_commit(message)` (a normal
  gated command), plus a "generate commit message" helper that drafts from the
  staged diff for the user to edit before committing. Never auto-commits.

## 3. Safety invariants (non-negotiable)
- **No command runs without approval** — per command, or a prefix rule the user
  created. The model can never self-authorise.
- Commands run in the workspace root; the command and cwd are shown before Run.
- Timeout + output cap + kill-on-abort; no surviving background processes.
- Read-only git tools may auto-run; anything that writes (commit) is gated.
- Execution is entirely in main; the renderer never spawns. No key to renderer.
- Opt-in: gated behind Agent mode (same as edits/MCP) and a workspace.
- Executable tests prove: an approved command runs in the root and its output
  returns; a rejected command never spawns; abort kills a running command; the
  output cap and timeout hold; a user-defined allow-prefix auto-runs only
  matching commands.

## 4. Decisions needed
- **A — Approval model:** (recommended) per-command gate + a user-defined
  session allow-prefix list; *or* a persistent configurable allowlist in
  settings. Recommend session prefixes now, persistent later.
- **B — Git surface v1:** (recommended) read-only git tools (status/diff/log)
  auto-run + a Git panel + gated commit with message-draft; *or* tools only, no
  panel (leaner). Recommend the panel — it's the loved part.
- **C — Shell:** (recommended) real platform shell (`sh -c`/`cmd /c`) so
  ordinary commands work; *or* no-shell arg-vector exec (safer but can't run
  pipelines/most real commands). Recommend the shell — it's a terminal — with
  approval as the guard.

## 5. Definition of done
Commands run behind an allowlist and git status/diff/commit are visible (the
plan's DoD item for #5): every command approved, bounded, and killable; git
state surfaced; each invariant in §3 proved by a test — shipped through review.
