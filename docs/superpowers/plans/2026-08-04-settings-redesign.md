# Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the inside of the Settings panels — panel titles, a provider/key card, list-based pickers, an informative rail and a real toggle — without changing the shell, the categories or the IPC surface.

**Architecture:** The 760 × 560 shell and four-category rail from the previous branch stay. Each panel gains a `PanelHead`; the Provider panel's three fields collapse into one card; both native `<select>`s become lists reusing `ModelPicker`'s row vocabulary; the Updates checkbox becomes a real `Switch`.

**Tech Stack:** React 19, TypeScript strict + ESM, Zustand store, plain CSS in `theme.css`, Vitest (jsdom) units, Playwright e2e.

**Spec:** [`docs/superpowers/specs/2026-08-04-settings-redesign-design.md`](../specs/2026-08-04-settings-redesign-design.md)

## Global Constraints

- **TypeScript strict + ESM.** Every relative import MUST carry a `.js` extension. Shared types via `@shared/types`.
- **No change to the IPC surface or to what any setting does.** This is presentation only.
- **`.dialog-actions` is shared with `SecretWarning.tsx:39`** — do not change its properties. Add new classes instead. `.key-status` is settings-only and may be retired once nothing references it.
- **Do not change any property of `.dialog`** (shared with the diff gate) or the `.settings-dialog` shell geometry (760 × 560, `grid-template-rows: auto 1fr auto`).
- **Every existing `data-testid` moves to whichever control inherits its job**, and where the mapping is not one-to-one the task says so explicitly. Never silently repoint a test id at a different control.
- Only the active panel is mounted — do not switch to hidden-but-mounted.
- Accent bar for the active rail row must match `.session-row[aria-current='true']::before` (3px × 18px) so selection means one thing app-wide.
- Price and context-window data are supplementary: render them only when present, never `undefined` or an empty column.
- Commit style `type: summary`. **Do NOT add a `Co-Authored-By: Claude` trailer.** No ESLint in this repo.
- Verify with `npm run typecheck`, `npm test`, `npm run test:e2e`.

## File Structure

| File | Responsibility |
|---|---|
| `src/renderer/settings/PanelHead.tsx` | **Create.** Title + description, used by all four panels. |
| `src/renderer/app/Switch.tsx` | **Create.** Accessible toggle (`role="switch"`, `aria-checked`). |
| `src/renderer/app/icons.tsx` | **Modify.** Add `IconKey`, `IconFailover`, `IconModes`, `IconUpdate`, `IconClose`. |
| `src/renderer/settings/SettingsDialog.tsx` | **Modify.** Grouped rail with icons/state/accent bar; icon close button; footer line. |
| `src/renderer/settings/panels/ProviderPanel.tsx` | **Modify.** Provider card + provider list + model list. |
| `src/renderer/settings/panels/UpdatesPanel.tsx` | **Modify.** Version card, state block, Switch. |
| `src/renderer/settings/panels/FailoverPanel.tsx` | **Modify.** Panel head. |
| `src/renderer/settings/panels/ModesPanel.tsx` | **Modify.** Panel head. |
| `src/renderer/app/theme.css` | **Modify.** All new classes. |

---

### Task 1: Shared foundations — PanelHead, Switch, icons

**Files:**
- Create: `src/renderer/settings/PanelHead.tsx`, `src/renderer/app/Switch.tsx`
- Modify: `src/renderer/app/icons.tsx`, `src/renderer/app/theme.css`
- Test: `tests/unit/settings-switch.test.ts` (create)

**Interfaces:**
- Produces: `PanelHead({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element`; `Switch({ checked, onChange, label, testId }: { checked: boolean; onChange: (next: boolean) => void; label: string; testId?: string }): React.JSX.Element`; icon exports `IconKey`, `IconFailover`, `IconModes`, `IconUpdate`, `IconClose`, each `({ size }: { size?: number })`.

- [ ] **Step 1: Write the failing Switch test**

Create `tests/unit/settings-switch.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import React from 'react'
import { Switch } from '../../src/renderer/app/Switch.js'

describe('Switch', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  function render(props: Parameters<typeof Switch>[0]): void {
    act(() => { createRoot(container).render(React.createElement(Switch, props)) })
  }

  it('exposes itself as a switch to assistive tech', () => {
    render({ checked: true, onChange: () => {}, label: 'Check automatically' })
    const el = container.querySelector('[role="switch"]')
    expect(el).not.toBeNull()
    expect(el?.getAttribute('aria-checked')).toBe('true')
    expect(el?.getAttribute('aria-label')).toBe('Check automatically')
  })

  it('reports aria-checked false when off', () => {
    render({ checked: false, onChange: () => {}, label: 'Check automatically' })
    expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
  })

  it('calls onChange with the toggled value', () => {
    const onChange = vi.fn()
    render({ checked: false, onChange, label: 'Check automatically' })
    const el = container.querySelector('[role="switch"]') as HTMLButtonElement
    act(() => { el.click() })
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('is a real button so it is keyboard reachable', () => {
    render({ checked: false, onChange: () => {}, label: 'x' })
    expect(container.querySelector('[role="switch"]')?.tagName).toBe('BUTTON')
  })

  it('carries a test id when given one', () => {
    render({ checked: false, onChange: () => {}, label: 'x', testId: 'updates-toggle' })
    expect(container.querySelector('[data-testid="updates-toggle"]')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/settings-switch.test.ts`
Expected: FAIL — cannot resolve `Switch.js`.

- [ ] **Step 3: Create `Switch.tsx`**

```tsx
/**
 * A real toggle.
 *
 * Replaces a raw `<input type="checkbox">` that was wrapped in `.key-status` —
 * a class whose other job is rendering the "Configured" status readout on the
 * Provider panel. One class doing both meant neither could be styled without
 * disturbing the other.
 *
 * `role="switch"` + `aria-checked` is the accessible equivalent of the checkbox
 * it replaces; keeping it a real <button> keeps it keyboard reachable and
 * space/enter activated for free.
 */
export function Switch({
  checked, onChange, label, testId,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  testId?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? ' is-on' : ''}`}
      {...(testId ? { 'data-testid': testId } : {})}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  )
}
```

- [ ] **Step 4: Create `PanelHead.tsx`**

```tsx
/**
 * The title and description at the top of every settings panel.
 *
 * Before this, each panel was a single `.field`, so its `<label>` — a 10.5px
 * uppercase micro-label meant to name one input — was doing the job of a panel
 * title. "Updates" and "API key" were set identically. This puts the panel name
 * in the display face and gives the micro-label its one job back.
 */
export function PanelHead({
  title, children,
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="panel-head">
      <h4>{title}</h4>
      <p>{children}</p>
    </div>
  )
}
```

- [ ] **Step 5: Add the icons**

**Only three icons are new.** The rail's Failover and Modes rows reuse icons that already exist:

| Rail row | Icon | Status |
|---|---|---|
| Provider & key | `IconKey` | new |
| Failover | `IconRetry` | **already exists** — the design's arc is the same retry glyph |
| Modes | `IconSliders` | **already exists** — the design's glyph *is* sliders |
| Updates | `IconUpdate` | new |
| Close | `IconClose` | new |

Do not add `IconFailover` or `IconModes`; importing the existing two keeps one glyph per concept.

`icons.tsx` wraps every icon in a shared `Svg` that already supplies `viewBox`, `fill`, `stroke="currentColor"`, the linecaps, `aria-hidden` and `focusable`. Follow that shape exactly — do not hand-roll `<svg>` elements:

```tsx
export const IconKey = (p: IconProps): React.JSX.Element => (
  <Svg {...p} strokeWidth={p.strokeWidth ?? 1.7}>
    <circle cx="8" cy="12" r="4" />
    <path d="M12 12h9M18 12v3.5" />
  </Svg>
)

export const IconUpdate = (p: IconProps): React.JSX.Element => (
  <Svg {...p} strokeWidth={p.strokeWidth ?? 1.7}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
    <path d="M5 19h14" />
  </Svg>
)

/** Replaces the `✕` character, which rendered in the body font at a different
 *  weight to every other control in the dialog. */
export const IconClose = (p: IconProps): React.JSX.Element => (
  <Svg {...p} strokeWidth={p.strokeWidth ?? 1.9}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
)
```

- [ ] **Step 6: Add the CSS**

Append to `src/renderer/app/theme.css`. Do not modify `.dialog`, `.dialog-actions` or `.field`.

```css
/* Panel title + description. The micro-label (.field label) goes back to
   naming a single input; this names the panel. */
.panel-head { display: flex; flex-direction: column; gap: 5px; }
.panel-head h4 {
  margin: 0;
  font: 500 17px/1.25 var(--font-display);
  letter-spacing: -0.2px;
  color: var(--text);
}
.panel-head p {
  margin: 0;
  max-width: 56ch;
  font: 400 12.5px/1.5 var(--font-body);
  color: var(--text-meta);
  text-wrap: pretty;
}

/* A real toggle, replacing a native checkbox wrapped in .key-status. */
.switch {
  flex: none;
  width: 38px;
  height: 22px;
  padding: 0 3px;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  border: none;
  border-radius: var(--radius-full);
  background: var(--hover-soft);
  cursor: pointer;
}
.switch.is-on { justify-content: flex-end; background: var(--accent); }
.switch-thumb { width: 16px; height: 16px; border-radius: var(--radius-full); background: #fff; }
.switch:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```

> `--font-display`, `--font-body`, `--text`, `--text-meta`, `--hover-soft`, `--accent` and `--radius-full` are existing tokens. Verify each resolves before using it; substitute the nearest real token and say so in the report if one does not exist.

- [ ] **Step 7: Verify**

Run: `npx vitest run tests/unit/settings-switch.test.ts`, then `npm run typecheck`, then `npm test`.
Expected: the Switch suite passes; nothing else changes (no component consumes these yet).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/settings/PanelHead.tsx src/renderer/app/Switch.tsx src/renderer/app/icons.tsx src/renderer/app/theme.css tests/unit/settings-switch.test.ts
git commit -m "feat(settings): PanelHead, Switch and the icons the redesign needs"
```

---

### Task 2: The rail — groups, icons, state, accent bar

**Files:**
- Modify: `src/renderer/settings/SettingsDialog.tsx`, `src/renderer/app/theme.css`
- Test: `tests/unit/settings-nav.test.ts` (extend)

**Interfaces:**
- Consumes: `IconKey`, `IconFailover`, `IconModes`, `IconUpdate`, `IconClose` from Task 1.
- Produces: rail test ids unchanged (`settings-tab-provider|failover|modes|updates`); new `settings-rail-state-<id>` on each row's state affordance.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/settings-nav.test.ts`:

```ts
  it('groups the rail under Connection, Workspace and Application', async () => {
    await render(container)
    const text = container.querySelector('[role="tablist"]')?.textContent ?? ''
    expect(text).toContain('Connection')
    expect(text).toContain('Workspace')
    expect(text).toContain('Application')
  })

  it('names the provider tab for what the panel actually does', async () => {
    await render(container)
    expect(container.querySelector('[data-testid="settings-tab-provider"]')?.textContent)
      .toContain('Provider & key')
  })

  it('shows OFF against Failover when no fallback is configured', async () => {
    useAppStore.setState({ fallbacks: [] })
    await render(container)
    expect(container.querySelector('[data-testid="settings-rail-state-failover"]')?.textContent)
      .toMatch(/off/i)
  })

  it('shows the mode count against Modes', async () => {
    useAppStore.setState({
      modes: [
        { id: 'a', name: 'A', systemPrompt: 'p', providerId: 'anthropic', model: 'm' },
        { id: 'b', name: 'B', systemPrompt: 'p', providerId: 'anthropic', model: 'm' },
      ],
    })
    await render(container)
    expect(container.querySelector('[data-testid="settings-rail-state-modes"]')?.textContent).toBe('2')
  })

  it('marks Updates only when there is something to act on', async () => {
    useAppStore.setState({ update: null })
    await render(container)
    expect(container.querySelector('[data-testid="settings-rail-state-updates"]')).toBeNull()
  })

  it('closes with an icon button rather than a text glyph', async () => {
    await render(container)
    const close = container.querySelector('[data-testid="settings-close-x"]')
    expect(close?.querySelector('svg')).not.toBeNull()
    expect(close?.textContent).toBe('')
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/settings-nav.test.ts`
Expected: FAIL on the group labels and the state affordances.

- [ ] **Step 3: Restructure the rail**

In `SettingsDialog.tsx`, replace the flat `CATEGORIES` array with grouped data and give each row an icon plus an optional state node. Keep `CategoryId` and every existing test id.

```tsx
type CategoryId = 'provider' | 'failover' | 'modes' | 'updates'

const RAIL: { group: string; items: { id: CategoryId; label: string }[] }[] = [
  { group: 'Connection', items: [
    { id: 'provider', label: 'Provider & key' },
    { id: 'failover', label: 'Failover' },
  ] },
  { group: 'Workspace', items: [{ id: 'modes', label: 'Modes' }] },
  { group: 'Application', items: [{ id: 'updates', label: 'Updates' }] },
]
```

Requirements for the rendered rail:
- Each row renders its icon (`provider→IconKey`, `failover→IconFailover`, `modes→IconModes`, `updates→IconUpdate`).
- Each row may render a state node with `data-testid={`settings-rail-state-${id}`}`: Failover shows `OFF` when `fallbacks` is empty and the fallback provider's label otherwise; Modes shows `modes.length` (omit the node entirely when zero); Updates shows a dot **only** when `update?.status` is `'available'` or `'ready'`.
- `role="tablist"` / `role="tab"` / `role="tabpanel"`, `aria-selected` on every tab, and `aria-controls` only on the selected one — all unchanged from today.
- The group labels are presentational; they must not be tabs and must not be focusable.
- The rail foot renders `IconLock` (already exists) plus "keychain-backed".
- Rail column width goes 180px → 208px.

Replace the `✕` glyph with `<IconClose />`, keeping `data-testid="settings-close-x"` and the `aria-label`.

Add the footer line to the left of Done: "Changes apply immediately — there is nothing to submit."

- [ ] **Step 4: Add the CSS**

Append to `theme.css`; update the existing `.settings-body` grid column from `180px` to `208px`.

```css
.settings-rail-group {
  padding: 16px 12px 8px;
  font: 600 10px/1 var(--font-body);
  letter-spacing: 1.1px;
  text-transform: uppercase;
  color: var(--text-meta);
}
.settings-rail-group:first-child { padding-top: 8px; }
.settings-rail-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
}
/* Same 3px × 18px bar as .session-row[aria-current='true']::before, so
   "selected" reads identically in the sidebar and here. */
.settings-rail-item.is-active::before {
  content: '';
  position: absolute;
  left: -10px;
  top: 9px;
  width: 3px;
  height: 18px;
  border-radius: 0 2px 2px 0;
  background: var(--accent);
}
.settings-rail-label { flex: 1; text-align: left; }
.settings-rail-state {
  flex: none;
  font: 400 11px/1 var(--font-mono, ui-monospace, monospace);
  color: var(--text-meta);
}
.settings-rail-pill {
  display: inline-flex;
  align-items: center;
  height: 17px;
  padding: 0 6px;
  border-radius: var(--radius-full);
  background: var(--hover-soft);
  font: 600 9.5px/1 var(--font-body);
  letter-spacing: 0.4px;
  color: var(--text-meta);
}
.settings-rail-dot {
  width: 6px; height: 6px;
  border-radius: var(--radius-full);
  background: var(--success);
}
.settings-rail-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  padding: 10px 12px;
  border-top: 1px solid var(--hairline);
  font: 400 11px/1.4 var(--font-mono, ui-monospace, monospace);
  color: var(--text-meta);
}
.settings-foot-note {
  flex: 1;
  font: 400 11.5px/1.4 var(--font-body);
  color: var(--text-meta);
}
```

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/unit/settings-nav.test.ts`, then `npm run typecheck`, then `npm test`.
Expected: PASS. Existing navigation tests must still pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/settings/SettingsDialog.tsx src/renderer/app/theme.css tests/unit/settings-nav.test.ts
git commit -m "feat(settings): grouped rail with icons, per-row state and an icon close button"
```

---

### Task 3: Provider & key panel

**Files:**
- Modify: `src/renderer/settings/panels/ProviderPanel.tsx`, `src/renderer/app/theme.css`
- Modify: `tests/e2e/settings.spec.ts`
- Test: `tests/unit/provider-panel.test.ts` (create)

**Interfaces:**
- Consumes: `PanelHead`, `IconKey` from Task 1; `ModelInfo.contextWindow`; `src/shared/pricing.ts`.
- Produces: test ids `provider-select` (now the Change control), `provider-option` (rows in the expanded list), `api-key-input`, `api-key-save`, `api-key-delete`, `key-status`, `model-select` (the list container), `model-option` (rows).

**Test-id mapping — state this in the report.** `provider-select` and `model-select` no longer name `<select>` elements; they name the Change control and the model list container respectively. Presence assertions survive; `selectOption()` calls do not.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/provider-panel.test.ts` covering, with the bridge mocked as in `tests/unit/settings-nav.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import React from 'react'
import { ProviderPanel } from '../../src/renderer/settings/panels/ProviderPanel.js'
import type { ProviderSummary } from '../../src/shared/types.js'

const PROVIDERS: ProviderSummary[] = [
  { id: 'anthropic', label: 'Anthropic', defaultBaseUrl: 'https://api.anthropic.com/v1', dataPolicy: { trainsOnInput: false, local: false } },
  { id: 'ollama', label: 'Ollama', defaultBaseUrl: 'http://localhost:11434', dataPolicy: { trainsOnInput: false, local: true } },
]

describe('ProviderPanel', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    ;(window as unknown as { modelith: unknown }).modelith = {
      keys: { has: vi.fn().mockResolvedValue(true), set: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) },
      providers: { models: vi.fn().mockResolvedValue([]) },
    }
  })

  async function render(over: Record<string, unknown> = {}): Promise<void> {
    const props = {
      providers: PROVIDERS, draftKey: '', setDraftKey: () => {},
      models: [], configured: true, setConfigured: () => {}, setModels: () => {},
      autoFocus: false, onProviderFocused: () => {},
      ...over,
    }
    await act(async () => {
      createRoot(container).render(React.createElement(ProviderPanel, props as never))
    })
  }

  it('states what the panel configures', async () => {
    await render()
    expect(container.querySelector('.panel-head h4')?.textContent).toBe('Provider & key')
    expect(container.querySelector('.panel-head p')?.textContent).toMatch(/keychain/i)
  })

  it('shows the key state prominently rather than as grey filler', async () => {
    await render({ configured: true })
    expect(container.querySelector('[data-testid="key-status"]')?.textContent).toMatch(/keychain|stored/i)
  })

  it('does not use a native select for the provider', async () => {
    await render()
    expect(container.querySelector('select')).toBeNull()
  })

  it('reveals the provider list only after Change is pressed', async () => {
    await render()
    expect(container.querySelectorAll('[data-testid="provider-option"]').length).toBe(0)
    const change = container.querySelector('[data-testid="provider-select"]') as HTMLButtonElement
    await act(async () => { change.click() })
    expect(container.querySelectorAll('[data-testid="provider-option"]').length).toBe(PROVIDERS.length)
  })

  it('renders a model row per model with its context window', async () => {
    await render({ models: [{ id: 'm1', label: 'claude-sonnet', contextWindow: 200000 }] })
    const row = container.querySelector('[data-testid="model-option"]')
    expect(row?.textContent).toContain('claude-sonnet')
    expect(row?.textContent).toMatch(/200k/i)
  })

  it('omits the context column when the model does not report one', async () => {
    await render({ models: [{ id: 'm1', label: 'local-model' }] })
    const row = container.querySelector('[data-testid="model-option"]')
    expect(row?.textContent).toContain('local-model')
    expect(row?.textContent).not.toMatch(/undefined|NaN/)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/provider-panel.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rebuild the panel**

Structure, top to bottom:

1. `<PanelHead title="Provider & key">Pick where turns are sent. The key is written to the OS keychain by the main process — the interface can replace or clear it, never read it back.</PanelHead>`
2. **The provider card** (`.provider-card`), three rows separated by hairlines:
   - **Identity row:** monogram tile (`provider.label[0]`, mono face), provider name, `DataPolicyBadge` + Policy link (reuse the existing component and markup), and a "Change" button carrying `data-testid="provider-select"` and `aria-expanded`.
   - **Provider list**, rendered only while expanded: one row per provider with `data-testid="provider-option"`, the accent check on the current one. Selecting calls the existing `setProvider` and collapses the list.
   - **Key state row** (`.provider-key-state`), tinted with `--success` when configured: check icon, "Key stored in the keychain" (or "No key stored"), and a "Remove" control carrying `data-testid="api-key-delete"`. Keep `data-testid="key-status"` on the status text.
   - **Key entry row:** input with `IconKey` and `data-testid="api-key-input"`, plus a "Replace" button carrying `data-testid="api-key-save"` (same disabled rule: empty draft).
3. **Model section:** a micro-label "Model" with the price line to its right (from `pricing.ts`, only when known), then a list container `data-testid="model-select"` holding `data-testid="model-option"` rows that reuse `.model-option`. Each row: accent check when selected, label, and context window formatted compactly (`200000 → 200k`) only when present.

Read `src/shared/pricing.ts` and `ModelPicker.tsx` first and reuse their helpers rather than duplicating formatting.

**Pricing shape, verified:** `PRICING` is `Record<string, ModelPrice>` keyed **`provider:model`**, where `ModelPrice` is `{ inputPerMTok: number; outputPerMTok: number }`. There is no formatter — `costOf()` computes a turn's cost, which is not what this panel wants. A model with no entry has **no** price, and the file's own comment is explicit that a missing entry must never fall back to a default: render nothing rather than a wrong number. Local runtimes are keyed with a zero price and genuinely cost nothing, so `$0.00 / $0.00` is correct for them and must not be mistaken for "unknown".

- [ ] **Step 4: Add the CSS**

Append `.provider-card`, `.provider-card-row`, `.provider-monogram`, `.provider-key-state`, `.model-list` and `.model-list-meta` rules to `theme.css`, following the design's values. Reuse `.model-option` for rows rather than redefining it.

- [ ] **Step 5: Update the e2e**

`tests/e2e/settings.spec.ts` uses `provider-select.selectOption('kimi')` twice. Replace each with clicking the Change control then the matching `provider-option` row. Do not weaken the surrounding assertions — the test must still prove the key clears when the provider changes.

- [ ] **Step 6: Verify**

Run: `npx vitest run tests/unit/provider-panel.test.ts`, `npm run typecheck`, `npm test`, `npm run test:e2e`.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/settings/panels/ProviderPanel.tsx src/renderer/app/theme.css tests/
git commit -m "feat(settings): provider, policy and key state as one card with list pickers"
```

---

### Task 4: Updates panel, remaining panel heads, and verification

**Files:**
- Modify: `src/renderer/settings/panels/UpdatesPanel.tsx`, `FailoverPanel.tsx`, `ModesPanel.tsx`, `src/renderer/app/theme.css`
- Modify: `tests/unit/updates-settings.test.ts`, `tests/e2e/updates.spec.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `PanelHead`, `Switch`, `IconUpdate` from Task 1.
- Produces: `updates-toggle` now names the `Switch` (a `role="switch"` button, not a checkbox).

- [ ] **Step 1: Update the Updates tests first**

In `tests/unit/updates-settings.test.ts`, the two `updates-toggle` tests currently cast to `HTMLInputElement` and read `.checked`. Rewrite them against the switch — assert `aria-checked` and that clicking calls `setEnabled(false)`. **Do not weaken them**: the click assertion must remain.

Add:

```ts
  it('splits the macOS caveat out of the status sentence', async () => {
    useAppStore.setState({
      update: { ...BASE, status: 'available', canAutoInstall: false, latestVersion: '0.4.0' },
    })
    await openUpdates(container)
    // The headline names the version; the explanation carries the caveat. They
    // are separate elements now, not one concatenated sentence.
    expect(container.querySelector('[data-testid="update-headline"]')?.textContent).toContain('0.4.0')
    expect(container.querySelector('[data-testid="update-explanation"]')?.textContent)
      .toMatch(/unsigned|manually|release page/i)
  })

  it('offers no state block when there is nothing to act on', async () => {
    useAppStore.setState({ update: { ...BASE, status: 'idle' } })
    await openUpdates(container)
    expect(container.querySelector('[data-testid="update-headline"]')).toBeNull()
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/updates-settings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rebuild the Updates panel**

1. `<PanelHead title="Updates">An anonymous GET to the public GitHub API on launch and every six hours. No identifiers, nothing about your conversations.</PanelHead>`
2. **Version card:** "Modelith {currentVersion}", a relative last-checked line from `lastCheckedAt` (omit when never checked), and "Check now" (`data-testid="updates-check-now"`) beside it.
3. **State block**, rendered only when `status` is `available`, `ready` or an error the user asked for: `IconUpdate`, a headline (`data-testid="update-headline"`), an explanation (`data-testid="update-explanation"`), and the install/download action (`data-testid="updates-install"`) inside the block. Accent-tinted for available/ready.
4. **Toggle row:** "Check automatically" + "On launch, then every six hours." + `<Switch testId="updates-toggle" />`.

`MANUAL_INSTALL_NOTE` stops being concatenated onto four status branches: the headline says what is happening and the explanation carries the caveat, so the note appears once. Keep `data-testid="updates-status"` on whichever element carries the primary status sentence, and keep the existing rule that `downloading` and `ready` never claim the platform cannot auto-install.

- [ ] **Step 4: Add panel heads to Failover and Modes**

Wrap each panel's existing content, keeping every control and test id untouched:

- Failover: title `Failover`, description "If the primary provider hits a rate limit or is unavailable before any text arrives, the turn retries here automatically." — moving the sentence that is currently a `.field-hint` up into the head.
- Modes: title `Modes`, description "Named presets. Applying one from the composer sets its system prompt and the current model for following turns." — likewise.

Remove the now-duplicated `.field-hint` paragraph from each so the sentence is not shown twice.

- [ ] **Step 5: Update the Updates e2e**

`tests/e2e/updates.spec.ts` asserts `toBeChecked()` on `updates-toggle`. Rewrite against `aria-checked`, keeping the round-trip assertion that the preference actually persisted.

- [ ] **Step 6: Full verification**

Run: `npm run typecheck`, then `npm test`, then `npm run test:e2e`. Report real counts.

- [ ] **Step 7: Changelog**

Add under `## [Unreleased]`:

```markdown
### Changed
- Settings panels now say what they configure. Each has a title and a short
  description, provider/policy/key state collapse into one card with the key
  state as the most prominent thing on the panel, the provider and model
  pickers are lists rather than OS dropdowns, and the rail carries icons,
  groups and per-row state.
```

- [ ] **Step 8: Commit**

```bash
git add src/renderer/settings src/renderer/app/theme.css tests/ CHANGELOG.md
git commit -m "feat(settings): redesign the Updates panel and give every panel a head"
```

---

## Manual verification (not automatable)

jsdom does not apply stylesheets, so no unit test proves the layout. After Task 4, run `npm run dev` and confirm:

1. The rail shows three groups, icons, the accent bar on the active row, and "keychain-backed" at its foot.
2. Provider & key: the card reads as one object, and the key state is the only tinted thing on the panel.
3. The model list matches the header `ModelPicker` — same row height, same accent check.
4. Updates: the toggle animates, and the state block only appears when there is something to act on.
5. The diff gate and the secret warning are unchanged — both share classes this work touches.
