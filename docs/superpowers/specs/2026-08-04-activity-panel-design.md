# Live activity panel — design

Date: 2026-08-04
Status: approved (design), pending implementation plan

## Problem

While an agent turn runs, the only sign of what it is doing is a collapsed
activity line appended to the transcript. Those lines scroll away as the reply
streams, so watching a multi-file change means chasing the viewport. And they
say *what* was called without saying *how much changed* — an edit reads as a
bare filename, with no indication whether it touched two lines or two hundred.

Comparable desktop agents pin this to a side panel: the running task's calls,
each with its diff stat, held still while the conversation scrolls beneath.

## Goals

1. See what the current turn is doing without scrolling.
2. Know the size of each edit, not just its filename.
3. Distinguish a write that landed from one that was proposed and rejected.

## Non-goals

- Per-call timings.
- Persistence across sessions or app restarts.
- Replacing the transcript's activity lines. They are the permanent record;
  this panel is the live view. The overlap is deliberate — one answers "what
  happened", the other "what is happening".
- Interaction beyond opening and closing. Approvals stay at the diff gate;
  there is no cancelling a call from here.
- Any new IPC channel. Two optional fields are added to an existing stream
  event; see Architecture for why the renderer cannot derive them itself.

---

## Architecture

Almost entirely renderer work. `src/renderer/chat/ActivityPanel.tsx` follows
the convention the other side panels already use (`GitPanel`, `McpPanel`,
`WorkspacePanel`): an `<aside className="workspace">` with an `inspector-head`,
rendered as a sibling in `App.tsx`, returning `null` when closed and toggled by
a store flag.

No new IPC channel and no new stream event — but **one small main-process
addition is required**, and the reason matters.

### Why the counts cannot come from the renderer

The obvious plan is to compute `+N −M` in the renderer from `tool_pending`,
which carries `previous` and `proposed`. That works only for **gated** writes.
`StreamEngine.requestApproval` short-circuits on a trusted turn:

```ts
if (this.trustedTurns.has(turnId)) return Promise.resolve({ action: 'accept' })
```

It returns **before** emitting `tool_pending`. So under trust-for-this-turn —
the feature that exists precisely so a multi-file change can run without a
click per file — no `previous`/`proposed` ever reaches the renderer, and the
panel would show counts for every write *except* the runs it is most useful
for.

So the counts come from main instead, on an event that fires for every write
regardless of path: `tool_result` gains two optional fields.

```ts
| { type: 'tool_result'; callId: string; name: string; ok: boolean; summary: string
    applied?: boolean
    /** Lines added/removed by a write. Absent for non-write tools. */
    added?: number; removed?: number }
```

Main already holds `previous` and `proposed` at apply time, so this is a
computation it can do for free. Two optional fields on an existing event cover
the gated, trusted and rejected paths uniformly, and mean the renderer needs no
diffing of its own — one source of truth rather than two implementations that
can disagree.

## The row model

One row per tool call, keyed by `callId`, folded from events the store already
receives:

| Event | Effect |
|---|---|
| `tool_call` | create the row — `name`, `arguments` |
| `tool_pending` | mark *awaiting approval*; record `relPath`. Emitted only for gated writes, so nothing the panel needs may depend on it |
| `tool_confirm` | mark *awaiting approval* — non-diff tools (e.g. MCP) |
| `tool_result` | resolve to done or failed; `applied` distinguishes a write that landed from one approved-but-not-written; `added`/`removed` supply the counts |

```ts
interface ActivityRow {
  callId: string
  name: string
  /** Root-relative path for file tools; absent for others. */
  relPath?: string
  /** From tool_result. Absent for non-write tools. */
  added?: number
  removed?: number
  status: 'running' | 'awaiting' | 'done' | 'failed' | 'not-applied'
  summary?: string
}
```

The `+N −M` counts are the only genuinely new information in this feature, and
the only thing requiring a change outside the renderer. Nothing computes them
today, which is exactly why an edit currently reads as a bare filename.

Rows live in an `activity: ActivityRow[]` store slice and are **cleared when a
new turn starts**, matching the decision that this is a live monitor rather
than a browsable record.

## Behaviour

- **Auto-opens** the first time a turn emits `tool_call`, then **stays open
  until dismissed**. It does not close itself between turns: a panel that
  appears and disappears twice per turn moves the layout while the user is
  reading, which is hostile in an app left open for long stretches.
- A plain chat turn emits no `tool_call` and never moves the layout.
- The manual toggle sits with the existing panel toggles, so it can be opened
  before a turn starts or closed mid-turn.

## Error handling

| Case | Behaviour |
|---|---|
| A row reaches `tool_pending` and never receives a `tool_result` — the user dismissed the diff gate, or the turn aborted | Settles to `not-applied` when the turn ends. It must not spin forever; an abandoned row that still reads "running" is worse than no panel. |
| `tool_result` with `ok: false` | `failed`, showing `summary`. |
| `tool_result` with `applied: false` | `not-applied` — never rendered as a write. A rejected edit reading as a completed one would misrepresent what is on disk. |
| A `tool_result` arrives with no matching `tool_call` | Create the row from the result. Losing an event must not lose the record of a call that ran. |
| `previous` is `null` (a new file) | Counts render as additions only, not `−0`. |

## Testing

The folding is where the logic is, so the tests target the reducer rather than
the DOM:

- `tool_call` → `tool_result` resolves to `done`.
- `tool_pending` → rejected renders `not-applied`, never `done`.
- `applied: false` never reads as a write.
- Counts come through on a **trusted** turn, not only a gated one. This is the
  case the renderer-only design silently missed, so it is the test that matters
  most.
- A non-write tool produces a row with no counts rather than `+0 −0`.
- A new turn clears previous rows.
- A pending row with no result settles to `not-applied` when the turn ends.
- A `tool_result` with no preceding `tool_call` still produces a row.

**E2E:** one test with the fake provider (`MODELITH_FAKE_PROVIDER=1`, using the
existing `agent multiwrite` trigger) asserting the panel auto-opens on an agent
turn and lists a row per file.

## Risks

- **Scope creep into a second transcript.** This is a monitor: read-only,
  current turn, no interaction. Every request to add filtering, history or
  actions to it should become its own decision, not an extension of this one.
- **The store's `applyEvent` is already the busiest function in the renderer.**
  The folding belongs in a separate pure reducer that `applyEvent` calls, so it
  can be unit-tested directly and does not add another branch to a function
  that is close to needing a split.
- **`tool_result` is persisted into the session JSONL.** Adding optional fields
  is backward-compatible in both directions, and older sessions simply replay
  without counts — but nothing may make them required.
