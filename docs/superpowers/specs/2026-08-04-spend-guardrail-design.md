# Spend guardrail — design

Date: 2026-08-04
Status: approved (design), pending implementation plan

## Problem

Modelith is bring-your-own-key: every turn spends the user's own money, at a
rate they cannot see until after the fact. The app already computes cost —
`costOf` in `src/shared/pricing.ts`, summed by `sessionCost` — and shows a
per-message badge and a session total in the header. Nothing acts on it.

The concrete fear this leaves unaddressed is a runaway agent. An agentic turn
is a *single* send that loops through many tool calls, each with its own model
round-trip. A loop that fails to converge can spend far more than the user
intended, and today nothing notices until they read the total afterwards.

That fear is a real reason not to turn agent mode on, which makes it a product
problem rather than an accounting one.

## Goals

1. A conversation that has spent more than the user intended asks before
   spending more.
2. A single runaway turn is caught **while it runs**, not reported afterwards.
3. The number shown is honest about what it cannot price.

## Non-goals

- Per-session budget *overrides*. There is one global setting; what is
  per-session is the **cap's scope** — it applies afresh to each conversation
  rather than to a running lifetime total.
- Monthly or all-time totals.
- Per-project budgets — those depend on the projects work, which is planned
  but unbuilt.
- Spend history, charts, or exports.
- Pricing a model that has no entry. `src/shared/pricing.ts` is explicit that
  a missing entry must never fall back to a guessed number, and this feature
  does not weaken that.

---

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Over budget | Warn and require confirmation | It never blocks work outright. A hard stop would hold a debugging session hostage to a number chosen weeks earlier; a silent readout would guard nothing. |
| Scope | Per session | Targets the runaway-loop case and resets naturally, because every new conversation starts from zero. |
| Unknown cost | Count what is known, show the gap | A budget that silently under-reports is worse than no budget, because it invites trust it has not earned. |
| Placement | Pre-send **and** inside the agentic loop | Pre-send alone is a readout with a dialog attached — it cannot catch the case the feature exists for. |
| Default | Off (`null`) | Nobody should meet a money dialog on first run because the app guessed a number for them. |

## Where the check happens

Two placements, because they catch different things.

| Where | Catches | Mechanism |
|---|---|---|
| Renderer, before a send | "This conversation has already cost $4.80" | Compare spend against the budget in the store's send path |
| Engine, between agentic iterations | A single turn running away | Pause and await a decision, exactly as the diff gate already does |

The engine placement is the one that matters. The renderer check is nearly
free once the shared helper exists, and it gives the user the warning at the
natural moment — before they commit to another turn.

**This is not a security boundary.** It protects the user from a loop, not
from an attacker, and the user can always continue. It therefore does not
carry the rigour of the workspace-confinement or key-handling paths, and
should not be designed as though a hostile renderer were trying to defeat it.

## One function, both sides

`sessionCost` currently lives in `src/renderer/chat/cost.ts` and deliberately
ignores turns it cannot price. Both facts have to change.

It moves to `src/shared/cost.ts` and reports the gap it used to swallow:

```ts
export function sessionSpend(
  messages: { usage?: Usage; provider?: string; model?: string }[],
): { total: number; unpriced: number }
```

The renderer imports it through the `@shared/*` alias, main through a relative
path. This is the point of the move: if the header and the gate summed spend
independently they would eventually disagree, and a dialog citing a number the
header does not show is worse than no dialog at all.

Formatting stays in the renderer. `formatCost` and `formatTotal` are
presentation and have no business in `shared/`.

**A local-provider turn is a real `$0`, not an unpriced one.** `costOf`
short-circuits on `LOCAL_PROVIDERS` and returns `0`; only a cloud model with
no `PRICING` entry is unpriced. Conflating the two would report every Ollama
conversation as untracked.

## The mid-turn gate

The engine already pauses mid-turn and waits for the user at the diff gate and
at `tool_confirm`, and `resolveApproval(callId, decision)` is generic over an
opaque `callId`. The budget gate reuses that machinery: it registers a pending
approval under its own id and emits one new stream event.

```ts
| { type: 'budget_pending'; callId: string; spent: number; budget: number; unpriced: number }
```

The renderer answers over the **existing** `chat:tool-decision` channel. One
new event type; no new IPC channel.

Rejecting ends the turn cleanly — the same path an aborted or rejected tool
call already takes. `streamChat` never throws, so a rejected budget prompt
still produces exactly one terminal `done`.

### Re-arming

After the user confirms, the gate re-arms at the next multiple of the budget:
a $5 budget prompts at $5, then $10, then $15.

Without this, one click disarms the guard for the rest of the session, which
is how a safety prompt becomes a formality people learn to dismiss.

## Settings and display

- **Setting:** `budgetPerSession: number | null` in the existing
  `AppSettingsStore`. `null` disables the feature entirely, and is the default.
- **Settings UI:** a fifth rail category, **Usage**. The categorised rail was
  built to take one, so this needs no layout change.
- **Header:** the existing session total becomes `≥ $4.20 · 3 unpriced` when
  anything went unpriced, and turns amber at **80% of the budget** — a
  concrete threshold rather than a vague "approaching", so the implementation
  has nothing to guess. The `≥` is doing real work: it says the true figure is
  at least this, never that it is exactly this.

## Error handling

| Case | Behaviour |
|---|---|
| `budgetPerSession` is `null` | The feature is entirely inert. No gate, no amber, no `≥` prefix. |
| Every turn in a session is unpriced | Spend is `0` and the gate never fires. The header shows the unpriced count, so the user can see the budget is not tracking anything. |
| A budget prompt is dismissed by an abort | Treated as a rejection: the turn ends, nothing further is spent. |
| Budget set to `0` | **Rejected** at the settings boundary. Off is `null`; a zero cap would also break re-arming, since every multiple of zero is zero and the gate would prompt on every iteration forever. |
| A negative or non-numeric budget | Rejected at the settings boundary; the stored value stays unchanged. |

## Testing

**Unit — the pure pieces, where the logic is:**

- `sessionSpend` totals priced turns and counts unpriced ones separately.
- A local-provider turn counts as a real `$0` and **not** as unpriced.
- A turn with no `usage`, or with no `provider`/`model`, counts as unpriced
  rather than as zero.
- The threshold predicate fires at the budget, not before it; re-arms at 2×
  and 3×; never fires when the budget is `null`.
- A budget of `0` is rejected rather than stored — the case that would
  otherwise make the gate prompt on every iteration forever.

**Engine — against the fake provider:**

- Crossing the budget mid-loop emits `budget_pending` and the loop *waits*
  rather than continuing while the prompt is open.
- Rejecting ends the turn with no half-applied tool call, and `done` still
  fires exactly once.

**E2E:** a tiny budget plus the existing `agent multiwrite` fake-provider
trigger, asserting the prompt appears *during* a turn — the property the whole
design rests on, and the one a pre-send-only implementation would silently
fail.

## Risks

- **`stream-engine.ts` is the most complex file in the codebase**, and this
  adds another pause-and-await path to its agentic loop. The mitigation is
  that it reuses the existing `pendingApprovals` mechanism rather than
  inventing a second one.
- **Moving `sessionCost` changes an existing call site** (`App.tsx`) and its
  signature. The change is small but it is a shared helper, so the move and
  the signature change should land together rather than leaving two summing
  functions alive at once.
- **A prompt that fires too often trains people to dismiss it.** Re-arming at
  multiples is the guard against that, and it is worth treating as a
  correctness property rather than a nicety.
