# Program Plan — Claude Desktop parity, and past it

**Date:** 2026-07-30
**Goal:** Open Coder should do everything Claude Desktop does, plus the things
competitors do that users love — while keeping the advantages Claude Desktop
lacks (any provider, local models, cost control, no telemetry).

This is a **program**, not a single plan. Each sub-project below is its own
brainstorm → spec → reviewed-build cycle, executed one at a time. Sub-plans are
written just before each phase, so each benefits from what the previous one
revealed rather than baking in guesses. This document is the sequencing and the
definition of done — the north star the sub-plans serve.

## Where we are

Shipped (v0 + redesign + lovable batch, all on `master`):

- Any-provider streaming chat (Anthropic, Kimi, OpenRouter, DeepSeek, Groq,
  Ollama, LM Studio), hardened Electron shell, OS-keychain secrets, sessions.
- Frameless platform chrome; model picker; per-message cost; failover;
  data-policy badges; context inspector; pin/archive/tags; branching; message
  edit; modes; command palette; outbound secret guard; side threads; text/code
  attachments.

Already **beats** Claude Desktop on: multi-provider, local models, cost/model
control, no telemetry.

## The gap to parity-plus

| Capability | Claude Desktop | Competitors love | Open Coder |
|---|---|---|---|
| Artifacts / live render | ✅ | Onlook, v0 | spec'd, not built |
| Project / folder access | ✅ (projects) | Cursor, Cline, Aider | **missing** |
| Agentic file edits w/ diff approval | — | Cline, Cursor | **missing** |
| MCP tools / connectors | ✅ | Cline, Cursor | **missing** |
| Image / PDF attachments (vision) | ✅ | all | text/code only |
| Terminal + command execution | — | Cline, Aider, Warp | **missing** |
| Git awareness | — | Aider, Cursor | **missing** |
| Checkpoints / rollback | — | Cline, Cursor | **missing** |
| Multi-model side-by-side ("race") | — | — (our wedge) | **missing** |

## Sub-projects, in execution order

Ordered by value-per-risk and dependency. Each ships working, tested software on
its own; each is independently mergeable.

### 1. Artifact canvas  ▸ spec exists
The tagline promise ("watch it build, see it render") and the clearest Claude
Desktop parity gap with a self-contained, low-risk design already approved
(`docs/superpowers/specs/2026-07-29-artifact-canvas-design.md`). HTML/SVG/Mermaid
render live in a sandboxed frame; point-and-refine; multi-artifact tabs.
**Why first:** designed, low-risk, high-visibility, no new privileged surface.

### 2. Workspace read + attachments-vision
Two parity gaps that are *read-only* and therefore safe to pair:
- **Workspace attach (read):** point at a folder; the agent can read files into
  context. No writes yet — reading is safe, and it's the foundation everything
  agentic builds on.
- **Vision attachments:** images/PDFs to vision-capable providers. This changes
  `ChatMessage.content` from a string to a parts array — a real content-model
  change, so it gets designed properly here rather than bolted on.
**Why second:** unlocks "projects"-like context and full attachment parity
without the danger of writing to disk.

### 3. Agentic edits — the diff-approve-edit gate + checkpoints
The highest-value coding capability and the highest-risk surface: the agent
*writes* files, but every write shows a diff you accept, reject, or hand-edit,
and a checkpoint is taken before each action for one-click rollback. This is what
makes it a coding tool rather than a chat app, and what Cline/Cursor users love.
**Why third:** depends on workspace read (#2); needs the most careful safety
design and its own thorough review.

### 4. MCP client + server browser
The Model Context Protocol tool ecosystem — Claude Desktop parity for
connectors, and a superset via a UI to discover/install servers instead of
hand-editing JSON. Tool calls flow through the existing stream engine's turn.
**Why fourth:** a whole subsystem, but it composes cleanly once the agent loop
(#3) exists.

### 5. Terminal + git awareness
Run commands with an approval allowlist, stream output back into context; branch/
diff/staged-hunks/commit-message generation. The depth that makes Aider and
Warp users loyal.
**Why fifth:** builds on the approval UX from #3 and the workspace from #2.

### 6. Model Race — the wedge nothing else has
Send one prompt to 2–4 models at once, parallel columns, pick the winner. The
20-second demo that spreads the project. Requires reworking the
one-turn-per-session invariant into per-session concurrent turns, so it is
deliberately last — it changes a load-bearing assumption and deserves undivided
attention.
**Why last:** highest architectural risk, and it shines most once the rest is a
complete product to show it off in.

## Definition of done (parity-plus, pre-prod)

- Artifacts render live (1).
- A folder can be attached and its files read into context; images attach (2).
- The agent can edit files behind a diff-approval gate with checkpoints (3).
- MCP servers can be added and their tools called in a turn (4).
- Commands run behind an allowlist; git status/diff/commit are visible (5).
- Model Race works for 2–4 providers at once (6).
- Every one of the above shipped through the review loop; the security invariants
  (no key to renderer, no unapproved disk write, no telemetry) hold throughout.

## Cross-cutting debts to retire along the way

Tracked in `docs/known-issues.md`; fold the relevant ones into whichever
sub-project touches them rather than a separate pass:

- Persist preferences (theme, model, provider) across restarts — currently
  in-memory. Fold into #2 (settings already persist fallbacks/modes).
- A dev-mode smoke test (all E2E run the built app today).
- ESLint/Prettier config before the contributor surface grows further.

## Method

Every sub-project: brainstorm (where the design isn't settled) → spec → plan →
implement task-by-task with a review after each and a whole-branch review before
merge. TDD for logic; security claims asserted by executable tests, never
comments. Exactly the loop that produced v0 with 2 Critical + 19 Important
defects caught before merge.
