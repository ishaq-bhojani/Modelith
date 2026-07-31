# Project Mode — design

Date: 2026-07-31
Status: approved (design), pending implementation plan

## Problem

Modelith can technically open a folder — `Workspace.pick()` uses the native
`openDirectory` dialog and the agent already has auto-running `read_file` and
`list_dir` tools. But in practice it does not feel like a project tool:

- **Discoverability.** Folder-open is buried behind a folder icon, then a second
  "Open folder…" button inside a side panel. The obvious-looking composer button
  is file-attach (a file picker), so users conclude "it can't open a directory."
- **The agent is blind on real repos.** It can `list_dir` and read files one at a
  time, but cannot search file contents, so finding where a symbol lives means
  reading files blindly. Slow and unreliable on anything non-trivial.
- **Per-edit approval friction.** Every write stops at a diff gate, one file at a
  time. A multi-file change is exhausting, which is the opposite of the
  "open a project and let it code" flow users expect.

Project Mode closes exactly these three gaps. It does **not** attempt full IDE
parity (no indexing/embeddings, no in-app editor, no auto-commit).

## Goals

1. The agent can **find** code across the project (content search), not just list
   and read.
2. Multi-file edits are **fluid but controlled**: one approval can cover the rest
   of a turn, and everything a turn wrote is still reverted by one action.
3. Opening a folder is **obvious and persistent**: a prominent entry point, a real
   collapsible file tree, a project header, and auto-restore on launch.

## Non-goals

- Codebase indexing / embeddings / semantic search.
- An in-app file editor or viewer pane.
- Auto-commit or any relaxation of git-commit gating.
- Changing the confinement model (reads/writes stay confined to the chosen root).

## Design

### Unit 1 — Content search (`search_files` tool)

**What it does.** A new read-only, auto-running tool `search_files` that searches
file *contents* under the workspace root and returns matches with locations.

**Main API.** Add `Workspace.search(query, opts?)`:

```ts
interface SearchHit { relPath: string; line: number; text: string }
interface SearchResult { hits: SearchHit[]; truncated: boolean; filesScanned: number }
search(query: string, opts?: { maxHits?: number; maxFileBytes?: number }): Promise<SearchResult>
```

- Reuses the existing confined traversal: same `isIgnored` prune, symlink skip,
  `MAX_ENTRIES` file cap, per-file `MAX_BYTES` (256 KB) ceiling, and the binary
  (NUL-byte) skip. Nothing outside the root is ever scanned.
- Plain **case-insensitive substring** match (v1 — no regex; keeps it simple and
  injection-free). One `SearchHit` per matching line.
- Caps: default `maxHits = 200`. When the cap is hit, stop and set
  `truncated: true`. `text` is the matched line, trimmed and length-capped
  (e.g. 200 chars) so a minified line can't blow up output.

**Tool spec.** Added to `TOOL_SPECS` (so it is offered whenever agent mode is on):

```
search_files(query: string) — Search file CONTENTS across the workspace.
  Returns "relPath:line: text" lines. Case-insensitive substring match.
```

`executeTool` gets a `search_files` branch that calls `workspace.search`, formats
hits as `relPath:line: text` newline-joined, appends a truncation note when
`truncated`, and returns `{ result, isError: false }`. Registered in the
`READ_ONLY` set and in `isKnownTool`.

**Why not ripgrep.** Shelling out to `rg` adds an external dependency that may not
be installed and reintroduces a process-spawn surface. A confined JS walk reuses
code we already trust and is portable.

### Unit 2 — Trust-for-this-turn (engine)

**What it does.** Lets the user approve one edit *and* elect to auto-apply the rest
of the current turn's gated actions, without a per-file click each time — while
keeping full revertability.

**Mechanism.**

- Extend the approval resolution so the renderer can reply with a trust flag.
  `ApprovalDecision` gains an optional marker; concretely the settle payload
  carries `trustTurn?: boolean` alongside `action: 'accept'`.
- The engine holds `private trustedTurns = new Set<string>()`. Keyed by `turnId`
  (which equals `streamId`, unique per user turn).
- `requestApproval` and `requestConfirm` both check `trustedTurns.has(turnId)`
  **first**. If trusted, they resolve `accept` immediately and emit **no** gate
  event. This covers writes (`write_file`/`apply_edit`) *and* command/MCP confirms
  (`run_command`, `git_commit`, `mcp__*`) — one trust decision, whole turn.
  - `turnId` must be threaded into both methods (today they receive
    `streamId`/`sessionId`; `turnId === streamId`, so pass it explicitly for
    clarity).
- When the user's decision arrives with `trustTurn: true`, the engine adds
  `turnId` to `trustedTurns` before resolving that first approval.
- **Cleanup / no leak.** `trustedTurns.delete(turnId)` runs when the turn ends
  (in the same place the stream is finalized — done/error/abort paths). Because
  the key is the unique per-turn id, a new user message starts untrusted and the
  gate returns.

**Safety invariants preserved.**

- Trusted writes still go through `Workspace.applyWrite`, which records a
  checkpoint pre-image, so **one "Revert edits" undoes the entire turn** exactly
  as today.
- Trust is per-turn and in-memory only; it is never persisted and never spans
  turns or sessions.
- A trusted `git_commit`/`run_command` still runs through the same arg-vector /
  shell path — trust changes *whether we ask*, never *how it executes*.

### Unit 3 — IPC / preload

- The renderer→main approval/confirm resolve payload gains optional
  `trustTurn?: boolean`. No new channels; the existing approve/confirm channel
  carries the extra field.
- Shared types + the preload bridge signature updated accordingly.

### Unit 4 — Renderer approval UI

- The diff gate (`DiffGate`) gains a second primary action:
  **"Accept & auto-apply rest of this turn"**, which resolves with
  `{ action: 'accept', trustTurn: true }`. The existing single-accept button is
  unchanged.
- The command/MCP confirm gate gains the same "…& trust this turn" affordance.
- While a turn is trusted, a small inline banner reads **"Auto-applying edits this
  turn"** so auto-applied changes are never invisible. Each applied file still
  produces its existing `tool_result` line (`Applied change to <path>`), and the
  turn-level revert bar still appears.

### Unit 5 — Persistent Project panel (renderer)

- **Collapsible tree.** Replace the flat checkbox list in `WorkspacePanel` with a
  folder tree built in the renderer from the existing flat `TreeEntry[]`
  (`relPath` + `kind` are sufficient to reconstruct nesting). Directories are
  expandable/collapsible; files show name + size.
- **Prominent entry point.** When no folder is open, show a clear top-level
  "Open Folder" call to action (not hidden behind an icon-only button).
- **Project header.** With a folder open, show the folder name as a header with a
  "Change" action.
- **Auto-restore on launch.** The root already persists in settings via
  `Workspace.pick`. The store bootstrap reads `workspace.current()`, and if a root
  exists, loads the tree and shows the project panel so the project is "present"
  on startup.
- **Add-to-context preserved.** The existing "tick files → add as fenced blocks"
  capability is kept as a per-file affordance in the tree, for non-agent chats.
- **No file viewer** (explicitly out of scope for this iteration).

### Unit 6 — System-prompt hint

When a workspace is open and agent mode is on, append one line to the system
prompt telling the model it can use `list_dir`, `search_files`, and `read_file` to
explore the project itself before editing. Keeps discovery autonomous.

## Data flow (agent turn, trusted)

1. User opens a folder (tree + header shown; root persisted).
2. User sends a prompt in agent mode.
3. Model calls `search_files` / `list_dir` / `read_file` (auto-run) to orient.
4. Model calls `write_file`/`apply_edit`. First call emits the diff gate.
5. User clicks **"Accept & auto-apply rest of this turn"** → engine records
   `turnId` in `trustedTurns`, applies the write (checkpointed), shows the
   "Auto-applying edits this turn" banner.
6. Subsequent writes/commands this turn auto-apply (checkpointed), each producing a
   `tool_result` line. No further gates.
7. Turn ends → `trustedTurns` cleared. Revert bar covers every file the turn wrote.
8. Next message starts untrusted; the gate returns.

## Testing

**Unit**
- `Workspace.search`: finds substrings across files; respects `isIgnored`,
  binary-skip, and `MAX_BYTES`; honors `maxHits` with `truncated: true`; never
  returns a path outside the root.
- Trust-for-turn: a trusted turn applies a second write with **no** gate event
  emitted; an untrusted turn still emits the gate; `trustedTurns` is cleared at
  turn end (no leak into the next turn).

**E2E** (fake provider)
- Open folder → the tree renders with a known seeded file; project header shows the
  folder name.
- Agent turn that writes two files: approving the first with "trust this turn"
  applies both from a single approval; the revert bar reverts both.
- `search_files` returns a hit for seeded content.

## Risks & mitigations

- **Trust misuse (a turn does more than expected).** Mitigated by: trust is
  per-turn only, the visible banner, per-file `tool_result` lines, and whole-turn
  revert. The default single-accept button is unchanged for cautious use.
- **Search output flooding context.** Mitigated by the `maxHits` cap, per-line
  length cap, and a truncation note.
- **Large tree performance.** The existing `MAX_ENTRIES` cap already bounds the
  tree; the renderer tree is built from that already-capped list.
