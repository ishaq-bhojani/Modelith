# Spec: Agentic edits — tool loop, diff-approval gate, checkpoints (sub-project #3)

**Status:** APPROVED. Decisions: A = universal pre-image snapshots in userData;
B = write_file + apply_edit + create (delete deferred); C = Anthropic +
OpenAI-compat tool-calling first (Ollama folded in if smooth).
**Roadmap:** the coding capability that makes this a coding tool, not a chat app.
**Depends on:** workspace read (#2, merged) for the confined-root foundation.
**Enables:** MCP (#4) and terminal (#5) reuse the same tool-calling loop.

This is the first surface that **writes to disk**, so the guiding rule is: *the
model proposes, the human disposes.* No byte is written without an explicit,
per-change human approval, and every applied change is reversible.

---

## 1. The three pieces

1. **A tool-calling loop** in the stream engine — the architectural addition.
   Today a turn is one provider stream. With tools, a turn becomes: stream →
   model emits tool calls → execute/gate them → feed results back → stream
   again → … until the model finishes with no pending calls (bounded by a hard
   iteration cap).
2. **A diff-approval gate** — any tool call that would modify the workspace is
   intercepted, rendered as a unified diff, and applied only on the user's
   Accept (with Reject and hand-Edit alternatives).
3. **Checkpoints** — before an approved write is applied, the file's pre-image
   is snapshotted so any change (or a whole turn) can be rolled back in one
   click.

---

## 2. Tools exposed (v1)

Confined to the workspace root exactly as reads are (#2 §A.2): resolve + realpath,
must be inside the realpath'd root, or the call is rejected before execution.

| Tool | Effect | Gate |
| --- | --- | --- |
| `read_file(path)` | returns file text | **auto-run** (read-only, confined) |
| `list_dir(path?)` | returns the tree (reuses §A tree) | **auto-run** |
| `write_file(path, content)` | full-file create/overwrite | **diff gate** |
| `apply_edit(path, search, replace)` | targeted search/replace | **diff gate** |

Reads auto-run because they are already safe and confined; making the user
approve every read would be noise. Writes always gate. **No `delete` and no
command execution in v1** — deletion is destructive-by-nature (defer, and when
added it gates with an extra confirm) and execution is sub-project #5.

Requirements before any tool runs: a workspace is open, and an "Agent edits"
mode is on (an explicit opt-in per §6), so tools never appear in a plain chat.

## 3. Tool-calling loop (engine)

- `StreamEvent` gains a `tool_call` variant (`{ id, name, arguments }`); the
  provider adapters translate each vendor's tool-call wire format into it
  (Anthropic `tool_use` blocks; OpenAI `tool_calls` deltas; Ollama tool calls).
  A `vision`-style `tools` capability marks which providers support it; a
  provider without tool support simply never emits tool calls (the mode is
  hidden for it).
- The engine loop (inside one `start()`):
  1. Stream a turn, assembling text and collecting any `tool_call`s.
  2. If none → finish exactly as today (`done`, persist).
  3. If some → for each: auto-run reads; for a write, **emit a
     `tool_pending` envelope to the renderer and await the user's decision**
     (accept/reject/edited-content) over a new IPC channel. Apply accepted
     writes through the checkpoint+confine path; record each tool result.
  4. Append an assistant tool-call message + the tool results to the message
     list and loop from 1.
- **Hard cap** on iterations (e.g. 12) and on total tool calls per turn; on
  reaching it the turn ends with a notice, never an infinite loop.
- Abort (`stop`) cancels the loop and any awaiting gate cleanly, marking the
  turn incomplete — same semantics as today.

This wraps the existing provider stream rather than replacing it; the reviewed
single-attempt/failover core stays intact (failover applies to the first
streamed turn; once tool calls begin, the turn is committed to that provider).

## 4. Diff-approval gate (renderer)

- A `tool_pending` write shows a **pending-edit card**: the file path, a
  unified diff (red/green), and **Accept · Reject · Edit**. New files show the
  whole content as additions.
- **Edit** opens the proposed content in an editor so the human can adjust
  before applying — what is applied is what they see.
- Reject sends a rejection tool-result back to the model ("change not applied"),
  so it can adapt rather than assume success.
- The turn's streaming visibly pauses at the gate; multiple pending writes are
  resolved one at a time, oldest first.
- Nothing about the diff is trusted from the model beyond the proposed content;
  the diff is computed in the renderer from the on-disk pre-image vs proposal.

## 5. Checkpoints & rollback

- **Mechanism (decision A, below):** before applying an approved write, copy the
  file's current bytes (the pre-image; empty marker for a new file) into a
  per-session checkpoint store under `userData` (never inside the workspace),
  keyed by turn id + tool-call id.
- The transcript shows a **checkpoint marker** per assistant turn that made
  edits: "Revert 3 changes". Reverting restores every pre-image from that turn
  (reverse order); a per-file undo is also offered on each applied-edit card.
- Checkpoints are metadata + blobs in `userData`; they never pollute the user's
  folder and are pruned by age/count.

## 6. Safety invariants (non-negotiable)

- **No write without per-change human approval.** No "approve all" in v1.
- **Confinement:** every write path resolves + realpaths inside the workspace
  root; creating a file realpaths its parent. Outside → rejected.
- **Opt-in:** an "Agent edits" mode; off by default; requires a workspace.
- **No execution, no delete** in v1.
- **No key to renderer** unchanged; tool execution is entirely in main.
- **Reversible:** every applied write has a checkpoint before it lands.
- Executable tests prove: a write outside the root is refused; a rejected diff
  writes nothing; an accepted diff writes exactly the approved bytes; revert
  restores the pre-image; the loop cap halts a runaway.

## 7. Decisions needed before implementation

- **A — Checkpoint mechanism:** (recommended) universal pre-image snapshots in
  `userData`, which work whether or not the folder is a git repo; *or*
  git-aware (snapshot via git when the workspace is a repo). Recommend universal
  now, git-awareness folded into #5.
- **B — v1 write toolset:** (recommended) `write_file` + `apply_edit` + create;
  defer `delete`. Confirm, or include delete behind a stricter confirm.
- **C — Provider scope for tools in v1:** (recommended) Anthropic + OpenAI-compat
  first (broadest tool support); Ollama tool-calling folded in if smooth.
  Confirm, or require all three up front.

## 8. Definition of done

The agent can edit files behind a diff-approval gate with checkpoints (the
plan's DoD item for #3): tools run in a bounded loop, every write is approved
and reversible, confinement holds, and each invariant in §6 is proved by a test —
all shipped through the review loop.
