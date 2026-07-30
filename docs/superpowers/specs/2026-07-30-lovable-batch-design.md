# Lovable Batch — Design Spec

**Date:** 2026-07-30
**Status:** Approved for planning.
**Depends on:** v0 core chat desktop + desktop redesign (merged to master)
**Roadmap items:** 2, 3(partial), 4, 5, 6, 20, 21, 22, 23, 24, 27, 28, 29, 32

## 1. What this is

The twelve roadmap features that make the app genuinely lovable **without new
architecture** — no filesystem writes, no concurrency rework, no MCP. Each is
additive to the shipped v0 core.

Deliberately excluded (each gets its own spec): Model Race (rewrites the
one-turn-per-session invariant), the artifact canvas (already specced),
filesystem/agent/terminal/git (highest-risk surface), and MCP.

## 2. Cross-cutting decisions

These are the load-bearing choices every feature below inherits.

### 2.1 Message provenance — the foundation

`ChatMessage` gains three optional fields:

```ts
export interface ChatMessage {
  id: string
  role: Role
  content: string
  createdAt: number
  incomplete?: boolean
  model?: string       // model id that produced an assistant reply
  provider?: string    // provider id that produced it
  usage?: Usage        // token counts from the provider's `done` event
}
```

The stream engine records `model`, `provider`, and `usage` onto the persisted
assistant message. All optional, so every existing session and test stays valid
and old messages simply render without a badge or cost. This one change unblocks
per-message model badges (feature 2), the cost meter (5), and any later report
card.

**Why on the message, not a side table:** provenance belongs to the turn that
produced it. Storing it anywhere else invites drift, and the JSONL store already
persists whatever shape `ChatMessage` has.

### 2.2 Cost is derived, never stored as money

A pricing table (`src/main/cost/pricing.ts`) maps `provider:model` → `{ inputPerMTok,
outputPerMTok }` in USD. `costOf(usage, provider, model)` is a pure function.
Prices are shipped as editable data (a plain object contributors PR-update), and
a model with no entry costs `null` — shown as "—", never a wrong number.

Cost is **computed from persisted `usage`**, never written to disk as a dollar
figure (prices change; a stored figure would rot). This run ships per-message and
per-session cost. Per-day and per-provider aggregates are deferred — noted, not
silently dropped.

### 2.3 Message content stays a string

Attachments in this run are **text and code files only**, injected into the
message content as fenced blocks with a small header. Image/vision support would
change `ChatMessage.content` from `string` to a parts array — a genuine
architectural change that ripples through rendering, persistence, and every
provider — so it is deferred to its own spec. This keeps the batch additive.

### 2.4 Editing rewrites the JSONL

The store is append-only, but editing a message and branching both need to
produce a session that is a *prefix* (or edited copy) of another. Add
`SessionStore.replaceMessages(id, messages[])` — an atomic rewrite (temp file +
rename, the pattern keystore and the index already use). Editing and branching
both build on it. Append-only remains the hot path for normal turns; rewrite is
the rare, explicit case.

### 2.5 System prompt injection

Modes (feature 24) need a system prompt. `chat.send` gains an optional
`systemPrompt`; the stream engine prepends it as a `system` message before
applying the context budget (the budget already always retains system messages,
and providers already handle the system role). No new provider work.

### 2.6 Secret scanning runs in the renderer, at compose time

Detection is a pure `scanSecrets(text)` returning matched ranges by category
(API keys, AWS keys, private-key headers, `.env`-style assignments). It runs in
the renderer *before* send so the user gets immediate feedback and a choice —
send anyway / cancel. This is a guard, not a guarantee: the trust boundary is
still that keys live in main, and this simply stops the common accident of
pasting a credential into a prompt. Property-tested like the SSE parser.

## 3. The twelve features

### 3.1 Multi-model (2, 3-partial, 6)

- **Model switching** already works (model is the current selection; context is
  the session). What's added: a **header model picker** dropdown (not only the
  settings dialog), and a **per-message model badge** rendered from §2.1
  provenance. Old messages without provenance show no badge.
- **Failover chains**: settings hold an ordered fallback list. On a `rate_limit`,
  `provider_5xx`, or `network` error, the stream engine retries the same turn on
  the next entry, emitting a visible `reasoning`-style notice ("Provider A rate
  limited — retrying on B"). Must preserve exactly-one-terminal-`done`. Tested
  against the contract-suite fakes.
- **Retroactive replay (partial)**: a "Retry on…" action on an assistant message
  re-runs the *preceding* user turn on a chosen model, appending a new reply.
  Full side-by-side diff is deferred; this is the one-model version.

### 3.2 Cost meter (5)

Per-message cost beside the model badge; a session total in the header. Computed
from §2.1 usage and §2.2 pricing. No entry → "—".

### 3.3 Context inspector (23)

A new `chat.preview(sessionId)` IPC runs `applyContextBudget` without sending and
returns `{ included: {role, tokens}[], omittedCount, totalTokens, budget }`. The
renderer shows a drawer listing exactly what would be sent, and a live context
meter in the composer (the design's "0 / 128k"). This surfaces `omittedCount`,
which main has always computed and never shown.

### 3.4 Command palette (32)

⌘K overlay. A command registry (new chat, open settings, toggle theme, switch
model, jump to session by title) with fuzzy filtering. Pure renderer.

### 3.5 Session organization (27)

Session index gains `pinned?`, `archived?`, `tags?`. Store methods set them.
Sidebar shows a pinned section on top, hides archived behind a toggle, and filters
by tag. Search already exists.

### 3.6 Branching (20)

"Fork here" on any message → `SessionStore.branch(sourceId, uptoMessageId)` copies
messages up to and including that one into a new session, selected immediately.

### 3.7 Side threads (21)

A right-drawer mini-chat seeded from a quoted selection, with its own stream and
its own ephemeral session, that does **not** append to the main conversation.
Closing it discards it. Keeps a clarifying aside out of the main context.

### 3.8 Edit any message (22)

Edit a **user** message → rewrite the session truncated after it (via §2.4) and
resend. Edit an **assistant** message → rewrite its content in place (put words in
its mouth, continue). Both use `replaceMessages`.

### 3.9 Modes (24)

Named presets `{ name, systemPrompt, model, temperature }` persisted in
`modes.json`. A mode picker applies the model and sends the system prompt (§2.5).
`temperature` flows through `chat.send` to the provider request.

### 3.10 Provider data-policy badges (29)

Provider registry gains `dataPolicy: { trainsOnInput: boolean, url }`. A badge in
settings and the model picker states plainly whether the provider may train on
inputs. Local providers (Ollama, LM Studio) are marked local/no-egress.

## 4. Non-negotiable invariants (unchanged)

- No API key reaches the renderer; no provider request originates there.
- Every IPC channel and payload declared in `src/shared/ipc.ts`, Zod-validated.
- One-turn-per-session in the stream engine — **failover and replay must not
  violate it.** Failover is a retry *within* one turn; replay starts a new turn
  through the normal guarded path.
- Exactly one terminal `done` per turn.
- Renderer draws only; secrets and network stay in main.
- Tests before implementation; every task ends with a commit; tests must fail
  against the bug they guard.

## 5. Plan decomposition

Executed phase by phase, each plan written just before its phase so it benefits
from what the previous revealed:

- **Plan A — Foundations:** provenance fields + engine recording; `replaceMessages`
  + `branch`; system-prompt + temperature in `send`; pricing module; secret
  scanner; session index pinned/archived/tags. (Pure/main-heavy, all tested.)
- **Plan B — Multi-model & cost:** header model picker, per-message badges, cost
  meter, failover chains, data-policy badges.
- **Plan C — Conversation craft:** context inspector, session-org UI, branching,
  edit message, modes.
- **Plan D — Desktop & trust:** command palette, secret-scan wiring, side threads,
  text/code attachments.

Each plan produces working, tested software on its own.
