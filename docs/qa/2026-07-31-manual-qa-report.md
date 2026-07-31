# Manual QA Report — Modelith

**Date:** 2026-07-31
**Method:** Exploratory manual testing of the real Electron app (fake provider,
temp workspace/git repo) — driving every screen, screenshotting each state and
inspecting it, cross-checked against the source. Automated suite also run: **275
unit + 54 e2e green**. Platform: Windows 11.

Legend — **B**locker · **H**igh · **M**edium · **L**ow/nit.

> **Update (2026-07-31): all findings addressed** on `fix/qa-findings`
> (275 unit + 56 e2e green). H1, M1–M6 and L1–L6/L10/L12 fixed; L8 was already
> correct; L7/L9 left as intentional design choices (noted inline); L11 was
> resolved by the earlier flex-drawer change. Fixes verified in the live app.

---

## Summary

The app is feature-complete and the automated suite is green, but manual use
surfaces one **systemic visual bug on primary action buttons** (they render as
tiny clipped circles), a couple of **state-leak bugs** around the agent "edits
applied" bar, and a batch of **cross-platform / modal-UX / polish** issues. None
corrupt data; the button-clipping and the revert-bar leak are the most damaging
to perceived quality.

Counts: **1 High, 6 Medium, ~12 Low/nit.**

---

## High

### H1 — Primary action buttons render as clipped circles (systemic)
**Where:** `DiffGate.tsx` (Accept, "Apply edited", tool-confirm **Run**),
`McpPanel.tsx` ("Add server"), `Composer.tsx` race start ("Race N models").
**Root cause:** these reuse `.send-button`, which is a **fixed 34×34,
`border-radius: full`** icon button (built for the composer's arrow). With a text
label the label is clipped inside a small circle. The only one that escaped is
Workspace's "Add … to context" because `.workspace-add` sets `width: 100%`;
`.mcp-add-btn` and `.race-go` override height/radius but **not width**, so they
stay 34px.
**Repro:** open the MCP panel → the add button reads "Add / erve" in a circle;
start a race → "Race 2 / models" squished in a circle; trigger an agent edit →
the **Accept** button is a circle showing "Accep".
**Impact:** the primary, most-important control of the agent/MCP/race/command
flows looks broken and its label is unreadable.
**Fix:** give text actions a real button style (auto width + horizontal
padding), or add `width:auto` overrides. Consider not reusing `.send-button` for
labelled buttons at all.
_Evidence: screenshots 09 (mcp), 12 (diff gate), 14 (race)._

---

## Medium

### M1 — "Edits applied to your files · Revert changes" bar leaks across sessions
**Where:** `store.ts` `lastEditTurnId` (global), rendered in `Composer.tsx`.
**Repro:** run an agent turn that edits a file in chat A → start a **New chat**
→ the new (unrelated) chat still shows "Edits applied to your files · Revert
changes". Confirmed visible in the Model-Race session and every later chat.
**Impact:** false claim that the current chat changed files; "Revert changes"
there reverts a *different* turn's edits.
**Fix:** clear `lastEditTurnId` on `newSession`/`selectSession`, or scope it per
session id.
_Evidence: screenshots 15, 16, 17, 18._

### M2 — A *rejected* write still shows "Edits applied / Revert changes"
**Where:** `tools.ts` (reject returns `isError:false`) → engine `tool_result`
`ok:true` → `store.ts applyEvent` sets `lastEditTurnId` when `ok && isWrite`.
**Repro:** agent proposes a write → click **Reject** → the revert bar appears
even though nothing was written.
**Fix:** distinguish "applied" from "rejected" (e.g. a flag on the tool result,
or only set `lastEditTurnId` when `applyWrite` actually ran).

### M3 — Modals don't close on Escape / backdrop click, and have no ✕
**Where:** `SettingsDialog.tsx`, `SecretWarning.tsx`, `DiffGate.tsx`
(tool-confirm) — none register an Escape handler and none close on backdrop
click. Settings has no header ✕; its only exit is a **"Done"** at the bottom of
a long scroll.
**Repro:** open Settings → press Esc (nothing) → click outside (nothing) → must
scroll to the bottom "Done". Same Esc-does-nothing for the secret gate and the
diff gate.
**Impact:** violates standard modal UX and keyboard accessibility.
**Fix:** add an Escape handler and backdrop-click-to-close to each modal, and a
header ✕ to Settings. Escape on the secret/diff gate should map to Cancel/Reject.

### M4 — Mac ⌘ glyphs shown on Windows/Linux
**Where:** `AppMenu.tsx` (`⌘N`, `⌘,`, `⌘Q`), `CommandPalette.tsx` (`⌘N`, `⌘,`),
`Sidebar.tsx` (`⌘F`), `Composer.tsx` hints (`⏎`, `⇧⏎` are fine; but the pattern).
**Impact:** on Windows these should read **Ctrl** (and Alt/Win); showing ⌘ is
incorrect and confusing. The app already knows the platform (`store.platform`).
**Fix:** render `⌘` on macOS and `Ctrl` elsewhere via a small helper.

### M5 — Canvas can't be closed, collapsed, or resized
**Where:** `CanvasPane.tsx` / `theme.css` (`.canvas { width: 44% }`).
**Repro:** produce any artifact → the canvas takes a fixed 44% forever; there is
no close/collapse button and no chat↔canvas splitter to rebalance.
**Fix:** add a collapse/close control (and ideally a draggable splitter like the
sidebar has).

### M6 — Sidebar is a fixed width, not responsive
**Where:** layout / `theme.css`.
**Repro:** shrink the window to the 760px minimum → the sidebar keeps its large
fixed width (~59% of the window), cramping the chat; there is no collapse.
**Fix:** smaller default width and/or a collapsible sidebar; clamp its share on
narrow windows.

---

## Low / nits

### L1 — Model provenance is force-uppercased
`.msg-model { text-transform: uppercase }` turns a real id like
`claude-3-5-sonnet` into `CLAUDE-3-5-SONNET`. Keep uppercase for the role label,
not the model id.

### L2 — No auto-titling of chats
Every session is "New chat / just now"; several are indistinguishable in the
sidebar. Consider titling from the first user message.

### L3 — Mermaid diagram uses the light theme in dark mode
The diagram renders light nodes on the dark canvas (mermaid `theme: 'default'`
regardless of app theme). Re-initialise mermaid with `theme: 'dark'` when the app
is dark (and on theme change).

### L4 — Casing inconsistency: "Open html in canvas" vs tab "HTML"
The transcript card lowercases the language ("Open html/svg/mermaid in canvas")
while the canvas tab uppercases ("HTML"). Normalise (uppercase HTML/SVG).

### L5 — Git panel: untracked files show as a collapsed "src/" with an empty diff
`git status --porcelain` collapses untracked dirs; clicking one runs `git diff`
which shows nothing for untracked paths. Use `-uall` to list untracked files and
show new-file contents (`git diff --no-index`) so a new file has a visible diff.

### L6 — Command palette omits the newer features
It offers New chat / Settings / theme / context inspector only — not Workspace,
MCP, Git, Race, or Agent toggle. Add them for a keyboard-first workflow.

### L7 — Composer toolbar is crowded (8 chips)
Mode · Attach · Files · Agent · MCP · Git · Race · Context wrap to two rows when
the chat column narrows (canvas open, or narrow window). Consider grouping the
tool toggles under an overflow "Tools" menu.

### L8 — Unlabeled sliders icon (bottom-left, by "Keys in the OS keychain")
Its purpose is unclear; add an `aria-label`/tooltip (it appears to open Settings).

### L9 — Composer is active before any provider/key is configured
On first run you can type and press send with no key; with a real provider this
only errors after sending. Consider nudging to Settings first (the fake provider
masks this in testing).

### L10 — `role: 'tool'` result messages render as assistant bubbles
After a tool round-trip, tool results persist and render with assistant styling
in the transcript. Give tool activity/results a distinct, quieter treatment.

### L11 — "Add … to context" button looked faint/partially clipped at the panel
bottom in one capture — verify the Workspace panel's action row placement at
shorter heights (low confidence; possibly just the disabled state).

### L12 — Settings: no focus management
The dialog doesn't autofocus a field or trap focus; `role="dialog"` has an
`aria-label` but no `aria-labelledby` to the `<h2>`.

---

## What's working well (verified in the live app)

- **Artifact canvas** — live HTML render and mermaid compile, with tabs, Branch,
  Select, and the transcript keeping the code + an "Open in canvas" card. Strong.
- **Secret guard** — correctly flags a pasted `sk-ant-…` key with a clear
  Cancel / Send-anyway modal, and shows a live token estimate.
- **Context inspector** — token meter + per-message token counts + budget.
- **Theming** — light and dark are both clean and consistent across every panel.
- **Diff gate content** — the red/green diff and "Create notes.txt" header read
  well (only the Accept button styling is broken — see H1).
- **Model Race** — parallel columns stream independently, each with Pick + a
  Cancel; the one-turn invariant holds.
- **Onboarding** — the first-run cards ("Watch it build, see it render") are a
  nice touch, and the frameless titlebar + custom app menu feel native.
- **Automated suite** — 275 unit + 54 e2e all green.

---

## Suggested fix order
1. **H1** (clipped buttons) — highest visible-quality win, small CSS change.
2. **M1 + M2** (revert-bar leak / rejected-write) — correctness of the agent flow.
3. **M3** (modal Escape/backdrop/✕) — accessibility + expected UX.
4. **M4** (Ctrl vs ⌘ on Windows) — correctness on the primary platform.
5. **M5/M6** (canvas close, responsive sidebar) — layout ergonomics.
6. The **L** nits as polish.
