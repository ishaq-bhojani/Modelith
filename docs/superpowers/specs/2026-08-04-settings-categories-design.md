# Categorized settings — design

Date: 2026-08-04
Status: approved (design), pending implementation plan

## Problem

The Settings dialog is a single 520px-wide column holding six stacked fields —
Provider, API key, Model, Failover, Modes, Updates — inside a `.dialog` that
sets `overflow-y: auto` on **the whole element**. Two consequences:

1. Reaching anything below the fold means scrolling, and the list only grows as
   settings are added.
2. Because the scroll container is the dialog itself, the "Settings" heading and
   the "Done" button scroll away with the content. At the bottom of the list
   there is no visible title and no visible way to close.

Separately, the Updates section reports "Version 0.3.2 is ready — restart to
install." but offers **no way to restart**. The only restart affordance is the
chip in the sidebar footer, which is dismissible — so a user who dismissed it
is told to restart with nothing to click.

## Goals

1. No scrolling to reach a setting in normal use; where scrolling is
   unavoidable, confine it to one pane rather than the whole dialog.
2. The title and the close action stay visible at all times.
3. Restarting to install is possible from Settings.
4. Adding a future settings category is a local change, not a re-layout.

## Non-goals

- Changing what any individual setting does. This is layout plus one button.
- Search across settings, or deep-linking to a category.
- A responsive/collapsing rail. Modelith is a desktop app with a minimum window
  size; the rail is always visible.
- Persisting the selected category across sessions.

---

## Layout

The settings modal gets its **own** class (`.settings-dialog`) rather than
changing `.dialog`, which is shared with the diff gate and other modals — see
Risks. That class is a fixed-size shell that does not scroll: `width: min(760px,
100%)`, `height: min(560px, 85vh)`, `overflow: hidden`. Inside it, a grid of
three rows — header, body, footer — where the body is a two-column split.

```
┌─────────────────────────────────────────────┐
│ Settings                                  ✕ │  pinned
├──────────────┬──────────────────────────────┤
│ Provider     │                              │
│ Failover     │   active category only       │  only this
│ Modes        │                              │  scrolls
│ Updates      │                              │
├──────────────┴──────────────────────────────┤
│                                      Done   │  pinned
└─────────────────────────────────────────────┘
```

The rail is a fixed ~180px column. Only the panel area carries
`overflow-y: auto`, so the header and footer can never scroll away.

## Categories

| Category | Contains | Why |
|---|---|---|
| **Provider** (default) | Provider select, API key, Model | One flow: pick a provider, authenticate, choose a model. Splitting them would make the common path a three-stop tour. |
| **Failover** | Fallback provider + model | Independent, rarely changed. |
| **Modes** | Named presets list + add form | The tallest section; the only one expected to scroll within its pane. |
| **Updates** | Version, auto-check toggle, status, Check now, Restart | Independent of provider config. |

**Provider is the default** because it is the first thing a new user needs and
the most frequently revisited.

## Components

`SettingsDialog.tsx` is 339 lines today and would grow with the rail. It splits
into a shell plus one component per category — matching the repo convention of
small, single-responsibility files, and keeping each panel independently
readable:

| File | Responsibility |
|---|---|
| `settings/SettingsDialog.tsx` | Shell: backdrop, header, rail, active panel, footer. Owns the active-category state. |
| `settings/panels/ProviderPanel.tsx` | Provider select, API key, Model |
| `settings/panels/FailoverPanel.tsx` | Fallback provider + model |
| `settings/panels/ModesPanel.tsx` | Modes list + add form |
| `settings/panels/UpdatesPanel.tsx` | Update state, toggle, Check now, Restart |

Each panel keeps its existing markup and **every existing `data-testid`
verbatim**. This is an extraction, not a rewrite: only the surrounding
navigation is new.

**State.** The active category is local `useState` in the shell, defaulting to
`'provider'`. It does not belong in the Zustand store — nothing outside this
dialog reads it, and it is deliberately not persisted (non-goal above).

Only the active panel is mounted. Rendering all four and hiding the inactive
ones would leave interactive controls in the accessibility tree and let tests
"pass" against panels a user cannot see.

## The Restart action

In the Updates panel, beside **Check now**, rendered only when there is
something to act on:

| State | Button | Action |
|---|---|---|
| `status === 'ready'` | "Restart to install" | `updates.install()` |
| `status === 'available'` and `!canAutoInstall` | "Download" | `updates.install()` |
| anything else | none | — |

Both call the same bridge method. Main already routes a non-auto-install
platform to `shell.openExternal` with a URL it built itself, so the renderer
still never handles a release URL — the existing trust boundary is unchanged.

New test id: `updates-install`.

## Accessibility

The rail is a real tab list, not styled buttons:

- Rail: `role="tablist"`, `aria-orientation="vertical"`.
- Each item: `role="tab"`, `aria-selected`.
- Panel: `role="tabpanel"`, `aria-labelledby` pointing at its tab.

`aria-controls` is set **only on the selected tab**, because only the active
panel is mounted — pointing the other three at element ids that do not exist
would be worse than omitting it.

Focus is left alone: clicking a tab leaves focus on that tab, which is the
standard behaviour. No custom arrow-key handling is added (YAGNI — every tab is
reachable with Tab, and the dialog already handles Escape via
`useEscapeToClose`).

## Test impact

Because **Provider is the default category**, most existing tests are
unaffected. The accurate picture:

| File | Change |
|---|---|
| `tests/e2e/settings.spec.ts` | **None** — uses `provider-select` / `api-key-input`, both on the default panel. |
| `tests/unit/settings-dialog.test.ts` | **None** — uses `api-key-input` / `api-key-save`. |
| `tests/e2e/updates.spec.ts` | One added click on the Updates tab before `updates-toggle`. |
| `tests/unit/updates-settings.test.ts` | Activate the Updates panel before querying. |
| `tests/e2e/conversation-craft.spec.ts` | One added click on the Modes tab before `mode-name`. |

Three files gain a navigation step. That is a faithful improvement: they will
exercise the path a user actually takes instead of reaching straight into a
panel that is not on screen.

**New coverage:**

- The rail renders one tab per category; Provider is selected on open.
- Clicking a tab swaps the panel — the previous panel's controls leave the DOM.
- `aria-selected` tracks the active tab.
- The header and footer are outside the scrolling region (assert the scroll
  container is the panel, not the dialog).
- Restart: appears at `ready`, appears as "Download" when `available` and
  `!canAutoInstall`, absent otherwise, and calls `updates.install()`.

## Risks

- **Extraction errors.** Moving four blocks of JSX into separate files risks a
  dropped handler or prop. Mitigated by keeping every `data-testid` and running
  the existing suites, which already cover the moved controls.
- **CSS regressions elsewhere.** `.dialog` is shared with other modals. The new
  layout rules must be scoped to the settings dialog (a distinct class) rather
  than altering `.dialog` itself, or the diff gate and other dialogs inherit a
  fixed height they do not want.
