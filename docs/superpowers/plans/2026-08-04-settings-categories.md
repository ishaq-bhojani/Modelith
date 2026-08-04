# Categorized Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Settings dialog's single scrolling column with a left rail of four categories, pin the header and Done button, and add the missing Restart-to-install action.

**Architecture:** `SettingsDialog.tsx` becomes a shell that owns the active category, the provider list, and the API-key draft. Each category moves into its own panel component under `settings/panels/`. Only the active panel is mounted. The settings modal gets its own CSS class so the shared `.dialog` rules used by other modals are untouched.

**Tech Stack:** React 19, TypeScript strict + ESM, Zustand store, plain CSS in `theme.css`, Vitest (jsdom) units, Playwright e2e.

**Spec:** [`docs/superpowers/specs/2026-08-04-settings-categories-design.md`](../specs/2026-08-04-settings-categories-design.md)

## Global Constraints

- **TypeScript strict + ESM.** Every relative import MUST carry a `.js` extension, even for `.ts`/`.tsx` sources. Shared types come from the `@shared/types` alias.
- **Every existing `data-testid` is preserved verbatim.** This work is an extraction plus navigation; renaming a test id is out of scope.
- **Do not change any property of the `.dialog` rule.** It is shared with the diff gate and other modals, and giving them a fixed height would break them. The settings modal uses a new `.settings-dialog` class. *Extending a selector list* is explicitly allowed and required once: `.dialog h2` becomes `.dialog h2, .settings-dialog h2` (Task 2), which adds a selector without altering `.dialog`'s own behaviour.
- **The renderer never handles a release URL.** The Restart/Download button calls `window.modelith.updates.install()`; main decides whether that installs or opens the release page.
- **Provider is the default category** — this is what keeps `tests/e2e/settings.spec.ts` and `tests/unit/settings-dialog.test.ts` passing unchanged.
- Commit style `type: summary`. **Do NOT add a `Co-Authored-By: Claude` trailer.**
- This repo has no ESLint. Do not add `eslint-disable` comments. (One pre-existing `eslint-disable-next-line react-hooks/exhaustive-deps` comment is being moved verbatim in Task 1 — leave it as-is, do not add new ones.)
- Verify with `npm run typecheck`, `npm test`, and `npm run test:e2e`. Report real counts.

## File Structure

| File | Responsibility |
|---|---|
| `src/renderer/settings/SettingsDialog.tsx` | **Modify.** Shell: backdrop, header, rail, active panel, footer. Owns active category, `providers`, `draftKey`. |
| `src/renderer/settings/panels/ProviderPanel.tsx` | **Create.** Provider select, API key, Model. Owns `models`, `configured`. |
| `src/renderer/settings/panels/FailoverPanel.tsx` | **Create.** Fallback provider + model. Owns `fallbackModels`. |
| `src/renderer/settings/panels/ModesPanel.tsx` | **Create.** Modes list + add form. Owns `modeName`, `modePrompt`. |
| `src/renderer/settings/panels/UpdatesPanel.tsx` | **Create.** Update state, toggle, Check now, Restart. Owns `updateStatusText`. |
| `src/renderer/app/theme.css` | **Modify.** Add `.settings-dialog` layout + rail rules. |

**State ownership rationale.** Panels read the Zustand store directly (matching how `SettingsDialog` already works); only two things are passed as props:

- `providers` — fetched once by the shell because **two** panels need it (Provider and Failover). Fetching twice would double the IPC call.
- `draftKey` — held by the shell so a half-typed API key survives switching to another category and back. Unmounting the panel would otherwise silently discard a pasted secret.

---

### Task 1: Extract the four panels (pure refactor)

No layout change and no behaviour change. All four panels still render stacked, in the same order, inside the existing `.dialog`. **Every existing test must pass untouched** — that green suite is the proof the extraction dropped nothing.

**Files:**
- Create: `src/renderer/settings/panels/ProviderPanel.tsx`
- Create: `src/renderer/settings/panels/FailoverPanel.tsx`
- Create: `src/renderer/settings/panels/ModesPanel.tsx`
- Create: `src/renderer/settings/panels/UpdatesPanel.tsx`
- Modify: `src/renderer/settings/SettingsDialog.tsx`

**Interfaces:**
- Consumes: the Zustand store (`useAppStore`), `window.modelith`.
- Produces:
  - `ProviderPanel(props: { providers: ProviderSummary[]; draftKey: string; setDraftKey: (v: string) => void }): React.JSX.Element`
  - `FailoverPanel(props: { providers: ProviderSummary[] }): React.JSX.Element`
  - `ModesPanel(): React.JSX.Element`
  - `UpdatesPanel(): React.JSX.Element`

- [ ] **Step 1: Run the existing suites to record the baseline**

Run: `npm test`
Expected: PASS. Note the exact count — the same count must hold at the end of this task. There is no new test here; this task's contract is "behaviour is identical", and the existing tests are the assertion.

- [ ] **Step 2: Create `ProviderPanel.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useAppStore } from '../../state/store.js'
import type { ModelInfo, ProviderSummary } from '@shared/types'
import { IconCheck, IconLock } from '../../app/icons.js'
import { DataPolicyBadge } from '../../app/DataPolicyBadge.js'

/**
 * Provider, API key and Model — one flow: pick a provider, authenticate,
 * choose a model. `draftKey` is owned by the shell so a half-typed key
 * survives switching category and back.
 */
export function ProviderPanel({
  providers, draftKey, setDraftKey,
}: {
  providers: ProviderSummary[]
  draftKey: string
  setDraftKey: (v: string) => void
}): React.JSX.Element {
  const reportError = useAppStore((s) => s.reportError)
  const providerId = useAppStore((s) => s.providerId)
  const setProvider = useAppStore((s) => s.setProvider)
  const model = useAppStore((s) => s.model)
  const setModel = useAppStore((s) => s.setModel)

  const [models, setModels] = useState<ModelInfo[]>([])
  const [configured, setConfigured] = useState(false)

  const selectedProvider = providers.find((p) => p.id === providerId)

  // Re-queries key status and the model list whenever the selected provider
  // changes — switching providers must immediately reflect that provider's own
  // key/model state, never the previous provider's stale values.
  useEffect(() => {
    void window.modelith.keys.has(providerId).then(setConfigured).catch(reportError)
    void window.modelith.providers.models(providerId).then((list) => {
      setModels(list)
      // `setProvider` resets `model` to '' (store.ts). Auto-selecting the
      // first available model on the happy path means a user who just
      // switches providers and clicks Done never ends up sending with an
      // empty model string.
      const first = list[0]
      if (first && !list.some((m) => m.id === model)) setModel(first.id)
    }).catch((err) => { setModels([]); reportError(err) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId])

  const save = async () => {
    try {
      await window.modelith.keys.set(providerId, draftKey)
      setDraftKey('')
      setConfigured(await window.modelith.keys.has(providerId))
      setModels(await window.modelith.providers.models(providerId).catch(() => []))
    } catch (err) {
      // `Keystore.set` genuinely throws when the OS keychain is unavailable
      // (e.g. a Linux box with no keyring running) — the user must see why
      // rather than watch the status silently stay "Not configured".
      reportError(err)
    }
  }

  return (
    <>
      <div className="field">
        <label htmlFor="provider">Provider</label>
        <select
          id="provider" data-testid="provider-select" value={providerId} autoFocus
          onChange={(e) => setProvider(e.target.value)}
        >
          {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {selectedProvider?.dataPolicy ? (
          <span className="field-policy">
            <DataPolicyBadge policy={selectedProvider.dataPolicy} />
            {selectedProvider.dataPolicy.url ? (
              <a href={selectedProvider.dataPolicy.url} target="_blank" rel="noreferrer">Policy</a>
            ) : null}
          </span>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="apikey">API key</label>
        <input
          id="apikey" data-testid="api-key-input" type="password" value={draftKey}
          placeholder={configured ? 'A key is stored. Enter a new one to replace it.' : 'Paste your key'}
          onChange={(e) => setDraftKey(e.target.value)}
        />
        <span className="key-status">
          {configured ? <IconCheck size={13} /> : <IconLock size={13} />}
          <span data-testid="key-status">{configured ? 'Configured' : 'Not configured'}</span>
        </span>
        <p className="field-hint">
          Stored with the OS keychain. The interface can set, replace and clear it, but can
          never read it back.
        </p>
        <div className="dialog-actions">
          <button
            className="button-compact"
            data-testid="api-key-save"
            disabled={draftKey.length === 0}
            onClick={() => void save()}
          >
            Save key
          </button>
          <button
            className="button-secondary"
            data-testid="api-key-delete"
            disabled={!configured}
            onClick={() => void window.modelith.keys.delete(providerId)
              .then(() => setConfigured(false))
              .catch(reportError)}
          >Remove key</button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="model">Model</label>
        <select id="model" data-testid="model-select" value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">Select a model</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        {models.length === 0 ? (
          <p className="field-hint">
            No models available yet. Providers that need a key list their models once one is
            stored.
          </p>
        ) : null}
      </div>
    </>
  )
}
```

- [ ] **Step 3: Create `FailoverPanel.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useAppStore } from '../../state/store.js'
import type { ModelInfo, ProviderSummary } from '@shared/types'

/** Fallback provider + model. Independent of the primary provider's config. */
export function FailoverPanel({ providers }: { providers: ProviderSummary[] }): React.JSX.Element {
  const providerId = useAppStore((s) => s.providerId)
  const fallbacks = useAppStore((s) => s.fallbacks)
  const setFallbacks = useAppStore((s) => s.setFallbacks)

  const [fallbackModels, setFallbackModels] = useState<ModelInfo[]>([])
  const fallback = fallbacks[0]

  // When a fallback provider is chosen, fetch its models so a concrete model
  // can be paired with it (the engine needs both).
  useEffect(() => {
    if (!fallback) { setFallbackModels([]); return }
    void window.modelith.providers.models(fallback.providerId)
      .then(setFallbackModels)
      .catch(() => setFallbackModels([]))
  }, [fallback?.providerId, fallback])

  return (
    <div className="field">
      <label htmlFor="fallback-provider">Failover (optional)</label>
      <div className="fallback-row">
        <select
          id="fallback-provider"
          data-testid="fallback-provider"
          value={fallback?.providerId ?? ''}
          onChange={(e) => {
            const pid = e.target.value
            if (!pid) { void setFallbacks([]); return }
            // Provisional until a model is chosen; the engine skips a
            // fallback whose model is empty, so this is harmless meanwhile.
            void setFallbacks([{ providerId: pid, model: '' }])
          }}
        >
          <option value="">No fallback</option>
          {providers
            .filter((p) => p.id !== providerId)
            .map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {fallback ? (
          <select
            data-testid="fallback-model"
            value={fallback.model}
            onChange={(e) => void setFallbacks([{ providerId: fallback.providerId, model: e.target.value }])}
          >
            <option value="">Select a model</option>
            {fallbackModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        ) : null}
      </div>
      <p className="field-hint">
        If the primary provider hits a rate limit or is unavailable before any text
        arrives, the turn retries here automatically.
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Create `ModesPanel.tsx`**

```tsx
import { useState } from 'react'
import { useAppStore } from '../../state/store.js'

/** Named presets. The tallest panel — the only one expected to scroll. */
export function ModesPanel(): React.JSX.Element {
  const providerId = useAppStore((s) => s.providerId)
  const model = useAppStore((s) => s.model)
  const modes = useAppStore((s) => s.modes)
  const saveMode = useAppStore((s) => s.saveMode)
  const deleteMode = useAppStore((s) => s.deleteMode)

  const [modeName, setModeName] = useState('')
  const [modePrompt, setModePrompt] = useState('')

  return (
    <div className="field">
      <label>Modes</label>
      <p className="field-hint">
        Named presets. Applying one (from the composer) sets its system prompt and the
        current model for following turns.
      </p>
      {modes.length > 0 ? (
        <ul className="mode-list">
          {modes.map((m) => (
            <li key={m.id} className="mode-list-item">
              <span className="mode-list-name">{m.name}</span>
              <button
                className="row-action row-action-danger"
                data-testid="delete-mode"
                aria-label={`Delete mode ${m.name}`}
                onClick={() => void deleteMode(m.id)}
              >✕</button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        data-testid="mode-name"
        placeholder="Mode name (e.g. Rust reviewer)"
        value={modeName}
        onChange={(e) => setModeName(e.target.value)}
      />
      <textarea
        className="mode-prompt"
        data-testid="mode-prompt"
        placeholder="System prompt"
        rows={3}
        value={modePrompt}
        onChange={(e) => setModePrompt(e.target.value)}
      />
      <button
        className="button-secondary"
        data-testid="mode-save"
        disabled={modeName.trim() === '' || modePrompt.trim() === ''}
        onClick={() => {
          void saveMode({
            id: `mode-${Date.now()}`,
            name: modeName.trim(),
            systemPrompt: modePrompt.trim(),
            providerId,
            model,
          })
          setModeName('')
          setModePrompt('')
        }}
      >
        Add mode (uses the current provider &amp; model)
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Create `UpdatesPanel.tsx`**

Move `MANUAL_INSTALL_NOTE` and `updateStatusText` here verbatim from `SettingsDialog.tsx` — they are used by nothing else. The Restart button is NOT added yet; that is Task 3.

```tsx
import { useAppStore } from '../../state/store.js'
import type { UpdateState } from '@shared/types'

// Settings is the always-available surface for update state (unlike the
// sidebar chip, which stays deliberately silent for most of the lifecycle):
// every status gets a line here, including the macOS "cannot auto-install"
// explanation, so it must live inside `updates-status` itself rather than a
// separate paragraph the test never looks at.
// Single source of truth for the manual-install sentence — referenced by
// every branch below that needs it, so a branch can no longer silently omit
// or diverge from it (as happened when the `error` case was rewritten
// without it during an earlier fix).
const MANUAL_INSTALL_NOTE =
  'This build cannot install updates automatically; download new versions manually from the release page.'

function updateStatusText(update: UpdateState | null): string {
  if (!update) return ''
  switch (update.status) {
    case 'error':
      return update.canAutoInstall
        ? (update.message ?? 'Update check failed.')
        : `${update.message ?? 'Update check failed.'} ${MANUAL_INSTALL_NOTE}`
    case 'ready':
      // Reaching 'ready' already means a build was downloaded and is staged
      // to install — appending the manual-install sentence here would
      // contradict "restart to install" in the same breath.
      return `Version ${update.latestVersion ?? ''} is ready — restart to install.`
    case 'downloading':
      // Mid-download, telling the user to go download manually instead is
      // self-contradictory regardless of `canAutoInstall`.
      // electron-updater reports a raw float (90.35480160960444), so format
      // it — the unrounded value spills across the status line.
      return `Downloading… ${(update.percent ?? 0).toFixed(2)}%`
    case 'checking':
      return update.canAutoInstall
        ? 'Checking…'
        : `Checking… ${MANUAL_INSTALL_NOTE}`
    case 'available':
      return update.canAutoInstall
        ? `Version ${update.latestVersion ?? ''} is available.`
        : `Version ${update.latestVersion ?? ''} is available. ${MANUAL_INSTALL_NOTE}`
    default:
      return update.canAutoInstall
        ? 'Up to date.'
        : `Up to date. ${MANUAL_INSTALL_NOTE}`
  }
}

export function UpdatesPanel(): React.JSX.Element {
  const update = useAppStore((s) => s.update)

  return (
    <div className="field">
      <label>Updates</label>
      <p className="field-hint" data-testid="updates-version">
        Modelith {update?.currentVersion ?? ''}
      </p>
      <label className="key-status">
        <input
          type="checkbox"
          data-testid="updates-toggle"
          checked={update?.enabled ?? true}
          onChange={(e) => void window.modelith.updates.setEnabled(e.target.checked)}
        />
        <span>Automatically check for updates</span>
      </label>
      <p className="field-hint" data-testid="updates-status">
        {updateStatusText(update)}
      </p>
      <div className="dialog-actions">
        <button
          className="button-secondary"
          data-testid="updates-check-now"
          onClick={() => void window.modelith.updates.check()}
        >
          Check now
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Rewrite `SettingsDialog.tsx` as the shell**

Replace the whole file. Note the effects that stayed: only the provider-list fetch remains here, because two panels need it.

```tsx
import { useEffect, useState } from 'react'
import { useAppStore } from '../state/store.js'
import type { ProviderSummary } from '@shared/types'
import { useEscapeToClose } from '../app/useEscapeToClose.js'
import { ProviderPanel } from './panels/ProviderPanel.js'
import { FailoverPanel } from './panels/FailoverPanel.js'
import { ModesPanel } from './panels/ModesPanel.js'
import { UpdatesPanel } from './panels/UpdatesPanel.js'

export function SettingsDialog(): React.JSX.Element | null {
  const open = useAppStore((s) => s.settingsOpen)
  const close = useAppStore((s) => s.closeSettings)
  const reportError = useAppStore((s) => s.reportError)

  // Owned here, not in ProviderPanel: two panels need the provider list, and
  // fetching it twice would double the IPC call.
  const [providers, setProviders] = useState<ProviderSummary[]>([])
  // Owned here so a half-typed API key survives switching category and back;
  // unmounting ProviderPanel would otherwise discard a pasted secret.
  const [draftKey, setDraftKey] = useState('')

  useEffect(() => {
    if (open) void window.modelith.providers.list().then(setProviders).catch(reportError)
  }, [open, reportError])

  useEscapeToClose(open, close)

  if (!open) return null

  return (
    <div className="dialog-backdrop" role="dialog" aria-labelledby="settings-title" aria-modal="true" onClick={close}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2 id="settings-title">Settings</h2>
          <button className="icon-button" data-testid="settings-close-x" aria-label="Close settings" onClick={close}>✕</button>
        </div>

        <ProviderPanel providers={providers} draftKey={draftKey} setDraftKey={setDraftKey} />
        <FailoverPanel providers={providers} />
        <ModesPanel />
        <UpdatesPanel />

        <div className="dialog-actions">
          <span className="dialog-spacer" />
          <button className="button-compact" data-testid="settings-close" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Verify behaviour is unchanged**

Run: `npm run typecheck`
Then: `npm test`
Then: `npm run test:e2e`
Expected: identical counts to Step 1's baseline, all passing. **No test file may be edited in this task.** If a test fails, the extraction dropped something — fix the panel, not the test.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/settings
git commit -m "refactor(settings): extract each category into its own panel component"
```

---

### Task 2: Left rail and categorized layout

**Files:**
- Modify: `src/renderer/settings/SettingsDialog.tsx`
- Modify: `src/renderer/app/theme.css`
- Modify: `tests/unit/updates-settings.test.ts`
- Modify: `tests/e2e/updates.spec.ts`
- Modify: `tests/e2e/conversation-craft.spec.ts`
- Test: `tests/unit/settings-nav.test.ts` (create)

**Interfaces:**
- Consumes: the four panel components from Task 1.
- Produces: test ids `settings-tab-provider`, `settings-tab-failover`, `settings-tab-modes`, `settings-tab-updates`, and `settings-panel`.

- [ ] **Step 1: Write the failing navigation test**

Create `tests/unit/settings-nav.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import React from 'react'
import { useAppStore } from '../../src/renderer/state/store.js'
import { SettingsDialog } from '../../src/renderer/settings/SettingsDialog.js'

function installBridge(): void {
  ;(window as unknown as { modelith: unknown }).modelith = {
    providers: { list: vi.fn().mockResolvedValue([]), models: vi.fn().mockResolvedValue([]) },
    keys: { has: vi.fn().mockResolvedValue(false), set: vi.fn(), delete: vi.fn() },
    updates: {
      getState: vi.fn().mockResolvedValue(null),
      check: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue(undefined),
      setEnabled: vi.fn().mockResolvedValue(undefined),
      onStateChange: vi.fn().mockReturnValue(() => {}),
    },
  }
}

async function render(container: HTMLDivElement): Promise<void> {
  await act(async () => { createRoot(container).render(React.createElement(SettingsDialog)) })
}

function click(container: HTMLDivElement, testid: string): Promise<void> {
  const el = container.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement
  return act(async () => { el.click() })
}

describe('Settings navigation', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    installBridge()
    useAppStore.setState({ settingsOpen: true, error: null, update: null })
  })

  it('renders one tab per category', async () => {
    await render(container)
    for (const id of ['provider', 'failover', 'modes', 'updates']) {
      expect(container.querySelector(`[data-testid="settings-tab-${id}"]`)).not.toBeNull()
    }
  })

  it('opens on Provider, so the most common settings need no navigation', async () => {
    await render(container)
    expect(container.querySelector('[data-testid="provider-select"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="settings-tab-provider"]')?.getAttribute('aria-selected')).toBe('true')
  })

  it('swaps the panel on click, unmounting the previous one', async () => {
    await render(container)
    await click(container, 'settings-tab-updates')
    expect(container.querySelector('[data-testid="updates-toggle"]')).not.toBeNull()
    // The old panel must be GONE, not merely hidden — a hidden panel would
    // still expose its controls to assistive tech and let tests pass against
    // a panel the user cannot see.
    expect(container.querySelector('[data-testid="provider-select"]')).toBeNull()
  })

  it('tracks aria-selected across a switch', async () => {
    await render(container)
    await click(container, 'settings-tab-modes')
    expect(container.querySelector('[data-testid="settings-tab-modes"]')?.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('[data-testid="settings-tab-provider"]')?.getAttribute('aria-selected')).toBe('false')
  })

  it('keeps a half-typed API key when leaving and returning to Provider', async () => {
    await render(container)
    const input = container.querySelector('[data-testid="api-key-input"]') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, 'sk-half-typed')
    await act(async () => { input.dispatchEvent(new Event('input', { bubbles: true })) })

    await click(container, 'settings-tab-updates')
    await click(container, 'settings-tab-provider')

    const returned = container.querySelector('[data-testid="api-key-input"]') as HTMLInputElement
    expect(returned.value).toBe('sk-half-typed')
  })

  it('exposes the rail as a tablist', async () => {
    await render(container)
    expect(container.querySelector('[role="tablist"]')).not.toBeNull()
    expect(container.querySelector('[role="tabpanel"]')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/settings-nav.test.ts`
Expected: FAIL — no `settings-tab-provider` element exists.

- [ ] **Step 3: Add the rail to the shell**

In `src/renderer/settings/SettingsDialog.tsx`, add above the component:

```tsx
type CategoryId = 'provider' | 'failover' | 'modes' | 'updates'

const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: 'provider', label: 'Provider' },
  { id: 'failover', label: 'Failover' },
  { id: 'modes', label: 'Modes' },
  { id: 'updates', label: 'Updates' },
]
```

Add the state (Provider first — this is what keeps the existing provider/key tests passing unchanged):

```tsx
  const [category, setCategory] = useState<CategoryId>('provider')
```

Replace the returned markup's inner container and the four stacked panels with:

```tsx
      <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head settings-head">
          <h2 id="settings-title">Settings</h2>
          <button className="icon-button" data-testid="settings-close-x" aria-label="Close settings" onClick={close}>✕</button>
        </div>

        <div className="settings-body">
          <div className="settings-rail" role="tablist" aria-orientation="vertical">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                role="tab"
                id={`settings-tab-${c.id}`}
                data-testid={`settings-tab-${c.id}`}
                className={`settings-rail-item${category === c.id ? ' is-active' : ''}`}
                aria-selected={category === c.id}
                // Only the ACTIVE panel is mounted, so pointing the other tabs
                // at element ids that do not exist would be worse than omitting
                // aria-controls entirely.
                {...(category === c.id ? { 'aria-controls': 'settings-panel' } : {})}
                onClick={() => setCategory(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div
            className="settings-panel"
            id="settings-panel"
            data-testid="settings-panel"
            role="tabpanel"
            aria-labelledby={`settings-tab-${category}`}
          >
            {category === 'provider' ? (
              <ProviderPanel providers={providers} draftKey={draftKey} setDraftKey={setDraftKey} />
            ) : null}
            {category === 'failover' ? <FailoverPanel providers={providers} /> : null}
            {category === 'modes' ? <ModesPanel /> : null}
            {category === 'updates' ? <UpdatesPanel /> : null}
          </div>
        </div>

        <div className="dialog-actions settings-foot">
          <span className="dialog-spacer" />
          <button className="button-compact" data-testid="settings-close" onClick={close}>Done</button>
        </div>
      </div>
```

- [ ] **Step 4: Add the CSS**

First, one **edit** to an existing selector. `.dialog h2` is scoped to `.dialog`, and the settings modal no longer carries that class — so its title would lose its font entirely. Extend the selector list (additive; `.dialog`'s own behaviour is unchanged):

```css
.dialog h2,
.settings-dialog h2 {
```

Then append the rest to `src/renderer/app/theme.css`. Do NOT change any property of the existing `.dialog` rule — it is shared with the diff gate and other modals.

```css
/* The settings modal is a fixed-size shell: only the panel scrolls, so the
   title and Done button can never scroll out of reach (which is what the
   single-column layout did). Deliberately NOT a change to `.dialog`, which
   other modals share. */
.settings-dialog {
  display: grid;
  grid-template-rows: auto 1fr auto;
  width: min(760px, 100%);
  height: min(560px, 85vh);
  overflow: hidden;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-lg);
  background: var(--canvas);
}
.settings-head {
  padding: 20px 24px;
  border-bottom: 1px solid var(--hairline);
  margin-bottom: 0;
}
.settings-body {
  display: grid;
  grid-template-columns: 180px 1fr;
  min-height: 0; /* lets the panel scroll instead of stretching the grid */
}
.settings-rail {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px;
  border-right: 1px solid var(--hairline);
  overflow-y: auto;
}
.settings-rail-item {
  padding: 8px 12px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-mute);
  font: 500 13px/1 var(--font-body);
  text-align: left;
  cursor: pointer;
}
.settings-rail-item:hover { color: var(--text); }
.settings-rail-item.is-active {
  background: var(--surface-raised);
  color: var(--text);
}
.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px 24px;
  overflow-y: auto;
  min-height: 0;
}
.settings-foot {
  padding: 14px 24px;
  border-top: 1px solid var(--hairline);
}
```

- [ ] **Step 5: Run the navigation test to verify it passes**

Run: `npx vitest run tests/unit/settings-nav.test.ts`
Expected: PASS, 6/6.

- [ ] **Step 6: Update the three tests that now need to navigate**

In `tests/unit/updates-settings.test.ts`, the dialog opens on Provider, so every test must switch to Updates first. Add this helper after `installBridge`:

```ts
async function openUpdates(container: HTMLDivElement): Promise<void> {
  await act(async () => { createRoot(container).render(React.createElement(SettingsDialog)) })
  const tab = container.querySelector('[data-testid="settings-tab-updates"]') as HTMLButtonElement
  await act(async () => { tab.click() })
}
```

Then replace every occurrence of the inline render line

```ts
    await act(async () => { createRoot(container).render(React.createElement(SettingsDialog)) })
```

with

```ts
    await openUpdates(container)
```

In `tests/e2e/updates.spec.ts`, in the test `'the Settings toggle persists the preference'`, add a tab click after opening settings:

```ts
  await page.getByTestId('open-settings').click()
  await page.getByTestId('settings-tab-updates').click()
  const toggle = page.getByTestId('updates-toggle')
```

In `tests/e2e/conversation-craft.spec.ts`, add a tab click after opening settings (before `mode-name`):

```ts
  await page.getByTestId('open-settings').click()
  await page.getByTestId('settings-tab-modes').click()
  await page.getByTestId('mode-name').fill('Terse')
```

- [ ] **Step 7: Verify the whole suite**

Run: `npm run typecheck`
Then: `npm test`
Then: `npm run test:e2e`
Expected: all passing. `tests/e2e/settings.spec.ts` and `tests/unit/settings-dialog.test.ts` must pass **without being edited** — they use only Provider-panel controls, and Provider is the default. If either needs a change, the default category is wrong.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/settings src/renderer/app/theme.css tests/
git commit -m "feat(settings): categorize settings behind a left rail

Only the active panel mounts, and only it scrolls — the title and Done
button stay pinned instead of scrolling out of reach."
```

---

### Task 3: Restart-to-install action

**Files:**
- Modify: `src/renderer/settings/panels/UpdatesPanel.tsx`
- Modify: `tests/unit/updates-settings.test.ts`

**Interfaces:**
- Consumes: `window.modelith.updates.install()`, the `UpdateState` store field.
- Produces: test id `updates-install`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/updates-settings.test.ts` (they use the `openUpdates` helper added in Task 2):

```ts
  it('offers a restart action once an update is ready', async () => {
    useAppStore.setState({ update: { ...BASE, status: 'ready', latestVersion: '0.4.0' } })
    await openUpdates(container)
    const button = container.querySelector('[data-testid="updates-install"]')
    expect(button?.textContent).toMatch(/restart/i)
  })

  it('calls install when the restart action is clicked', async () => {
    useAppStore.setState({ update: { ...BASE, status: 'ready', latestVersion: '0.4.0' } })
    await openUpdates(container)
    const button = container.querySelector('[data-testid="updates-install"]') as HTMLButtonElement
    await act(async () => { button.click() })
    expect(window.modelith.updates.install).toHaveBeenCalled()
  })

  it('offers a download action when the platform cannot auto-install', async () => {
    useAppStore.setState({
      update: { ...BASE, status: 'available', canAutoInstall: false, latestVersion: '0.4.0' },
    })
    await openUpdates(container)
    expect(container.querySelector('[data-testid="updates-install"]')?.textContent).toMatch(/download/i)
  })

  it('offers no action while merely checking', async () => {
    useAppStore.setState({ update: { ...BASE, status: 'checking' } })
    await openUpdates(container)
    expect(container.querySelector('[data-testid="updates-install"]')).toBeNull()
  })

  it('offers no action when an update is available and will auto-install itself', async () => {
    // canAutoInstall platforms download automatically; the user acts at
    // 'ready', not before, so a button here would be premature.
    useAppStore.setState({
      update: { ...BASE, status: 'available', canAutoInstall: true, latestVersion: '0.4.0' },
    })
    await openUpdates(container)
    expect(container.querySelector('[data-testid="updates-install"]')).toBeNull()
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/updates-settings.test.ts`
Expected: FAIL — no `updates-install` element.

- [ ] **Step 3: Add the button**

In `UpdatesPanel.tsx`, add above the return:

```tsx
  // Only when there is something to act on. Both cases call the same bridge
  // method: main decides whether that installs or opens the release page, so
  // the renderer never handles a release URL.
  const installLabel =
    update?.status === 'ready' ? 'Restart to install'
      : update?.status === 'available' && !update.canAutoInstall ? 'Download'
        : null
```

Then inside the existing `dialog-actions` div, before the "Check now" button:

```tsx
        {installLabel ? (
          <button
            className="button-compact"
            data-testid="updates-install"
            onClick={() => void window.modelith.updates.install()}
          >
            {installLabel}
          </button>
        ) : null}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/updates-settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the whole suite**

Run: `npm run typecheck && npm test`
Then: `npm run test:e2e`
Expected: all passing. Report real counts.

- [ ] **Step 6: Update the changelog**

Add under `## [Unreleased]` in `CHANGELOG.md` (create the section if it is absent):

```markdown
### Changed
- Settings is now organised into categories (Provider, Failover, Modes,
  Updates) behind a left rail. The title and Done button stay put instead of
  scrolling away, and only the selected category scrolls.

### Added
- A restart action in Settings → Updates, so a ready update can be applied
  without hunting for the sidebar chip (which is dismissible).
```

- [ ] **Step 7: Commit**

```bash
git add src/renderer/settings tests/unit/updates-settings.test.ts CHANGELOG.md
git commit -m "feat(settings): add a restart-to-install action to the Updates panel"
```

---

## Manual verification (not automatable)

jsdom does not apply stylesheets, so no unit test can prove the layout is
right — a test asserting it would pass whether or not the CSS works. After
Task 3, run the app (`npm run dev`) and confirm by eye:

1. Open Settings. The rail shows four categories with Provider selected.
2. Select **Modes** and add several modes until the panel overflows. The panel
   scrolls; the "Settings" title and the "Done" button do **not** move.
3. Select **Updates**. The version, toggle, status and buttons all fit without
   scrolling.
4. Type into the API key field, switch to Updates, switch back — the text is
   still there.
5. Open the diff gate (any agent write) and confirm it is unchanged — it shares
   `.dialog`, which this work must not have altered.
