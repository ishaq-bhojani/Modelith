# Settings modal redesign

Date: 2026-08-04
Status: approved (design), pending implementation plan

Source: `Modelith Settings.dc.html` in the Claude Design project
`cd458826-d874-434e-930b-4e6d6b08a791` (sections 2a "as built" / 2b "proposed",
plus the Updates panel comparison).

## Problem

The categorized-settings work gave the modal a shell — a 760 × 560 grid, a left
rail, a pinned header and footer. It did not touch what lives inside the panels,
which is still exactly what was there when everything was one scrolling column:

- **Every panel is a single `.field`.** So `<label>` — a 10.5px uppercase
  micro-label meant to name one input — is doing the job of a panel title.
  "Updates", "Modes" and "Failover (optional)" are set at the same size as
  "API key".
- **No panel has a title or a description.** The user lands on a form with no
  statement of what it configures.
- **Three native `<select>`s.** OS chrome, OS dropdowns, OS focus rings — inside
  a dialog where `ModelPicker` already ships a designed model list.
- **The key state is buried.** "Configured" is the most important fact on the
  Provider panel and it is 12px of grey text wedged between an input and a hint.
- **Close is a text glyph.** `✕` as a character, in a codebase with a 27-icon
  set, rendering in the body font at a different weight to every other control.
- **A 180px rail with four flat items** and 430px of nothing under them; a 64px
  footer holding one button.
- **Two classes doing double duty.** `.key-status` is a status readout on
  Provider and the wrapper for a raw checkbox on Updates; `.dialog-actions` is
  both the footer bar and an inline button pair.

## Goals

1. Each panel states what it configures, in the display face.
2. The most important fact on a panel is the most prominent thing on it.
3. Controls reuse the app's existing designed vocabulary rather than OS chrome.
4. The rail carries enough information to justify its width.
5. Retire the double-duty classes.

## Non-goals

- Changing the 760 × 560 shell, the four categories, or the IPC surface. This is
  the inside of the panels.
- Any change to what a setting does. Every behaviour is preserved.
- Light theme work. The app is dark-only.
- The 16-icon set from the brand document. Every icon this redesign needs is
  embedded in the settings design and is added here directly.

---

## Verified against the codebase

The design asserts five things about the repo. All five hold:

| Claim | Verified |
|---|---|
| `ModelInfo.contextWindow` is on the wire and unused by the UI | `src/shared/types.ts:88`; no renderer reference |
| Prices come from `pricing.ts` | `src/shared/pricing.ts` |
| `.model-option` exists in `ModelPicker` | `theme.css:1041`, `ModelPicker.tsx:89` |
| A 3px accent bar marks selection | `.session-row[aria-current='true']::before` — 3px × 18px |
| `--success` exists as a token | `theme.css:28-29` (`--success`, `--success-text`) |

## Changes

### Shared

- **`.panel-head`** — an Inter Tight 17px title plus a 12.5px description, at
  the top of every panel. The micro-label goes back to labelling one field.
- **`.switch`** — a real toggle. Retires `.key-status`'s second job as a
  checkbox wrapper.
- **Close button** uses the icon set instead of the `✕` character.
- **Footer** gains "Changes apply immediately — there is nothing to submit." on
  the left. True of every panel, and it answers the "did Done save this?"
  question the current bare bar invites.

### Rail

208px (from 180px), three labelled groups, and per-row state:

| Group | Row | State shown |
|---|---|---|
| Connection | Provider & key | — |
| Connection | Failover | `OFF` pill, or the fallback provider |
| Workspace | Modes | count |
| Application | Updates | a dot when an update is available |

Each row gains an icon; the active row gets the same 3px accent bar
`.session-row[aria-current='true']` uses, so "selected" means one thing across
the app. The rail foot carries a lock icon and "keychain-backed", which reads as
a property of the whole dialog rather than a footnote on one field. "Provider"
becomes "Provider & key" because that is what the panel does.

### Provider & key panel

Provider, policy and key state collapse into **one bordered card** of three rows:

1. **Identity** — a monogram tile (the provider's initial, mono face), the
   provider name, its data-policy badge and Policy link, and a "Change" control.
2. **Key state** — the only tinted thing on the panel, in `--success`: a check
   in a filled circle, "Key stored in the keychain", and "Remove" — so status
   and the destructive action are co-located instead of a button pair mid-form.
3. **Key entry** — an input with a key icon and a "Replace" button.

**The provider `<select>` is replaced.** "Change" expands a provider list using
the same row vocabulary as the model list below it. This is the one place the
design implies a control it does not draw, and it is the source of most of the
test churn below.

The **model `<select>` becomes a list** reusing `.model-option` — same accent
check, same row height — so the same choice looks the same here and in the
header picker. Each row gains its context window (`ModelInfo.contextWindow`,
already on the wire); the panel gains a price line from `pricing.ts`.

### Updates panel

- A **version card**: "Modelith x.y.z", when it was last checked, and "Check
  now" beside the version it acts on — so the footer-style button pair
  disappears and there is no ambiguity about which button is primary.
- A **state block** when there is something to act on: accent-tinted, an icon, a
  headline (`0.3.2 is available`), an explanation, and the action inside the
  block that describes it.
- A **real toggle** for "Check automatically", with "On launch, then every six
  hours." beneath it.

This splits `MANUAL_INSTALL_NOTE`, which is currently concatenated onto four
different status branches, into a headline plus an explanation that lives in one
place.

### Failover and Modes

The design draws these only as rail entries. They receive the same
`.panel-head` treatment so the modal is not half-redesigned — two panels with
titles and descriptions beside two bare forms is the exact inconsistency this
work exists to remove. Their copy is extrapolated, not specified, and is called
out for review in the plan.

---

## Test impact

This is the costly part, and it is larger than the categorized-settings work:

| File | Change |
|---|---|
| `tests/e2e/settings.spec.ts` | `provider-select.selectOption(...)` ×2 must become "Change" → pick a provider row. Presence assertions still work if `provider-select` names the new control. |
| `tests/unit/settings-nav.test.ts` | `provider-select` presence assertions survive if the test id is carried over; the API-key draft test still applies. |
| `tests/unit/updates-settings.test.ts` | `updates-toggle` stops being an `<input type="checkbox">`, so `toggle.checked` becomes an `aria-checked` assertion. |
| `tests/e2e/updates.spec.ts` | Same — `toBeChecked()` becomes an `aria-checked` assertion. |
| `tests/unit/settings-dialog.test.ts` | `api-key-input` / `api-key-save` survive; the save button is relabelled "Replace" but keeps its test id. |

**Every existing `data-testid` is carried onto whichever control inherits its
job.** A test that changes because the control genuinely changed is honest
churn; a test id that quietly moves to a different control is not, so where the
mapping is not one-to-one the plan states it explicitly.

## Risks

- **The provider "Change" affordance is under-specified.** The design shows the
  collapsed state only. Implemented as an expanding list reusing the model-row
  vocabulary — a decision made here, not in the design.
- **`.dialog-actions` is shared outside settings** — `SecretWarning.tsx:39`
  uses it (verified). Retiring its second job inside settings must not restyle
  that dialog, so the redesign adds new classes rather than editing the shared
  one. `.key-status` is settings-only (verified: no non-settings renderer use),
  so it can be retired outright once nothing references it.
- **Price and context data may be missing** for a given model. Both are
  supplementary, so both render only when present rather than showing an empty
  column or `undefined`.
