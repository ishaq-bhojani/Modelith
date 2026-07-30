# Spec: Model Race (parity sub-project #6)

**Status:** DRAFT — awaiting sign-off before reworking the engine.
**Depends on:** the stream engine (turn model), providers, cost.
**The wedge:** send one prompt to 2–4 models at once, compare in parallel
columns, pick the winner — the 20-second demo nothing else has.

This is deliberately last because it touches the most load-bearing assumption:
**one turn per session**. The design keeps that invariant intact by treating a
race as a *single turn* whose one assistant reply is chosen from several
candidates — not as several concurrent turns writing to one session.

## 1. The invariant, preserved
Today `StreamEngine` marks a session busy for the duration of a turn and appends
exactly one assistant message at the end. Concurrent turns to one session are
forbidden because `SessionStore.append` does not serialise same-session writes.

A race **is one turn**: the session is marked busy once; the user message is
appended once; then N provider streams run **concurrently but write nothing to
the store**; their text streams into N renderer columns held in transient state.
When the user picks a winner, **only that candidate** is appended as the
assistant message. Losers are discarded (decision A). The store therefore still
sees one user + one assistant append per turn — the invariant holds.

## 2. Engine
- `startRace(input, entries[])` where each entry is `{ providerId, model }`
  (2–4). It:
  1. Reserves the session (same busy guard) and appends the user message once.
  2. Budgets context once (shared prompt) and launches N `streamChat` calls in
     parallel, each tagged with a `columnId`.
  3. Emits column-tagged stream events (text/reasoning/done/error) to the
     renderer; **no store writes** during streaming.
  4. Holds each column's assembled text + provenance + usage in memory keyed by
     `raceId`.
- `chooseRaceWinner(raceId, columnId)` appends the chosen candidate as the
  assistant message (content + winning model/provider + usage) and releases the
  session. Choosing is required to finalise; closing without choosing discards
  the race (nothing persisted beyond the already-saved user message — which is
  consistent with an aborted turn).
- Abort cancels all columns; no winner is auto-chosen.
- Agent/tool mode is **off** for races in v1 (tool gating across parallel
  columns is out of scope) — races are plain completions.

## 3. Events & IPC
- A race envelope carries `{ raceId, columnId, event }` on a channel parallel to
  `chat:event` (or the existing envelope gains an optional `columnId`). The
  renderer routes each event to its column.
- IPC: `chat.startRace(input, entries)` → `{ raceId }`; `chat.chooseWinner(raceId,
  columnId)`; abort reuses the existing abort by raceId.

## 4. Renderer
- A **race control** in the composer: a multi-select of 2–4 provider/model
  targets (drawn from configured providers) and a "Race" send.
- A **race view** replacing the single transcript reply for that turn: N columns
  side by side, each streaming its model's answer with a live label and running
  cost; a **Pick** button per column. Picking collapses the race to the chosen
  reply in the normal transcript; the turn is now an ordinary persisted exchange.
- Horizontal scroll/wrap for narrow windows; columns are read-only while
  streaming.

## 5. Safety & correctness invariants
- A race is one turn: the busy guard is taken once; exactly one assistant message
  is ever appended (on pick), so concurrent same-session store writes never
  happen.
- No key to renderer unchanged; all N provider calls run in main.
- Abort cancels every column; a discarded race persists nothing new.
- Cost is shown per column (each call is billed) so the user sees what a race
  costs.
- Executable tests prove: N columns stream independently; picking appends only
  the chosen text with the winning provenance; the losers are not persisted; a
  second race cannot start while one is in flight (busy guard); abort cancels.

## 6. Decisions needed
- **A — Losers:** (recommended) discard non-picked candidates; *or* keep them as
  collapsed "alternatives" under the chosen reply. Recommend discard for v1.
- **B — Model selection UI:** (recommended) a dedicated 2–4 multi-select race
  control in the composer; *or* reuse the failover/fallback list. Recommend the
  dedicated control (races and failover are different intents).
- **C — Turn accounting:** (recommended) a race is exactly one turn (busy guard
  once, one append on pick) — the safe design above; no alternative that keeps
  the invariant.

## 7. Definition of done
Model Race works for 2–4 providers at once (the plan's DoD item for #6): columns
stream concurrently, the winner is picked and persisted as the turn's reply, the
one-turn-per-session invariant holds, and each invariant in §5 is proved by a
test — shipped through the review loop.
