# Lovable Batch — Implementation Plan

**Spec:** [2026-07-30-lovable-batch-design.md](../specs/2026-07-30-lovable-batch-design.md)
**Branch:** `feat/lovable-batch`

Executed directly with the full suite (`npm test`, `npm run typecheck`,
`npm run test:e2e`) as the gate. Every pure/logic module is TDD: a failing test
that would catch the bug, then the implementation. Each task ends green and
committed.

## Global constraints (from the spec)

- No API key to the renderer; no provider request from the renderer.
- Every IPC channel + payload in `src/shared/ipc.ts`, Zod-validated.
- One-turn-per-session preserved; exactly one terminal `done` per turn.
- Renderer draws only. TS strict, `noUncheckedIndexedAccess`. No `any` without
  a justifying comment.

---

## Plan A — Foundations

**A1. Message provenance.** `ChatMessage` gains `model?`, `provider?`, `usage?`.
`StreamEngine` records the model/provider it used and the `usage` from the `done`
event onto the persisted assistant message. Unit-test the engine records them;
no schema breaks (all optional).

**A2. Atomic rewrite + branch.** `SessionStore.replaceMessages(id, messages)` —
rewrite the JSONL via temp-file+rename (the keystore/index pattern).
`SessionStore.branch(sourceId, uptoId)` — new session with messages up to and
including `uptoId`. Both unit-tested, including that a crash-simulated partial
temp write never corrupts the original.

**A3. System prompt + temperature in send.** `SendSchema` gains optional
`systemPrompt` and `temperature`; the engine prepends the system message before
budgeting; providers receive `temperature`. Contract-suite fakes assert
temperature reaches the request body.

**A4. Pricing module.** `src/main/cost/pricing.ts` — `PRICING` table +
`costOf(usage, provider, model): number | null`. Pure, tested (known model, missing
model → null, zero usage).

**A5. Secret scanner.** `src/shared/secret-scan.ts` — `scanSecrets(text):
SecretMatch[]` over API-key / AWS-key / private-key-header / `.env` patterns.
Pure, property-tested (a clean prompt never matches; a planted key always does).

**A6. Session index fields.** Index gains `pinned?`, `archived?`, `tags?`; store
methods `setPinned`, `setArchived`, `setTags`. Serialized through the existing
index write; unit-tested.

---

## Plan B — Multi-model & cost

**B1. Header model picker** — a real dropdown listing configured providers'
models; switching sets `providerId`/`model`. Replaces the settings-only path.

**B2. Per-message model badge + cost** — `MessageView` renders `model` + `costOf`
from provenance; old messages show neither. `pricing:get` IPC ships the table to
the renderer.

**B3. Session cost total** — header shows summed cost of the loaded session.

**B4. Failover chains** — fallback list in settings; engine retries a retryable
error on the next entry within the same turn, emitting a visible notice; one
terminal `done` preserved. Tested against contract fakes.

**B5. Data-policy badges** — provider registry `dataPolicy`; badge in settings +
picker.

---

## Plan C — Conversation craft

**C1. Context inspector** — `chat.preview(sessionId)` IPC → included messages,
per-message tokens, `omittedCount`, total, budget. Drawer + composer meter.

**C2. Session-org UI** — pinned section, archived toggle, tag filter + editor.

**C3. Branching** — "Fork here" action → `branch` + select.

**C4. Edit message** — edit user (rewrite-truncate-resend) / assistant (rewrite in
place) via `replaceMessages`.

**C5. Modes** — `modes.json` persistence, mode picker, applies model + system
prompt + temperature.

---

## Plan D — Desktop & trust

**D1. Command palette** — ⌘K overlay, command registry, fuzzy filter.

**D2. Secret-scan wiring** — run `scanSecrets` on send; a match opens a confirm
modal (send anyway / cancel).

**D3. Side threads** — right-drawer mini-chat from a quoted selection, own
ephemeral session, discarded on close.

**D4. Attachments (text/code)** — attach files, injected as fenced context blocks;
no content-model change.
