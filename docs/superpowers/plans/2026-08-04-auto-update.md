# Software Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modelith checks GitHub for a newer release, downloads it in the background where the platform allows, and shows a quiet chip prompting the user to restart and install.

**Architecture:** A main-process `UpdaterService` owns a single `UpdateState` object and pushes it to the renderer over IPC. It talks to an injected `UpdaterBackend`, chosen once at construction: `ElectronUpdaterBackend` (Windows/Linux, wraps `electron-updater`), `CheckOnlyBackend` (macOS, a single GitHub API GET because unsigned builds cannot auto-install), or `NullBackend` (unpackaged — dev and every e2e run). All version math and error-message mapping lives in a pure `policy.ts`.

**Tech Stack:** Electron 43, TypeScript strict + ESM, `electron-updater`, zod IPC schemas, Zustand renderer store, Vitest units, Playwright e2e.

**Spec:** [`docs/superpowers/specs/2026-08-04-auto-update-design.md`](../specs/2026-08-04-auto-update-design.md)

## Global Constraints

- **TypeScript strict + ESM.** Every relative import MUST carry a `.js` extension, even for `.ts` sources.
- **No network in the renderer.** CSP is `connect-src 'self'`; all update traffic is main-process only.
- **The renderer never supplies owner, repo, or feed URL.** These are constants in `src/main/updater/policy.ts`.
- **The updater never throws across IPC.** Every failure becomes `status: 'error'` with a message we authored. No response body is ever echoed into `message`.
- **`releaseUrl` is constructed by main** from the version tag; a URL from an API response is never passed to `shell.openExternal`.
- **Repo constants:** owner `ishaq-bhojani`, repo `Modelith`.
- **Cadence:** first check 10_000 ms after ready; interval 6 * 60 * 60 * 1000 ms.
- **Commit style:** `type: summary`. **Do NOT add a `Co-Authored-By: Claude` trailer.**
- **Branch:** all work lands on `feat/auto-update`.
- Run `npm run typecheck` and `npm test` before any completion claim. `npm run test:e2e` builds first.

## File Structure

| File | Responsibility |
|---|---|
| `src/main/updater/policy.ts` | **Create.** Pure logic: repo constants, version compare, check-due math, `canAutoInstall`, release-URL construction, error→message mapping. No Electron import. |
| `src/main/updater/backend.ts` | **Create.** `UpdaterBackend` interface + `CheckOnlyBackend`, `NullBackend`, `FakeUpdaterBackend`, `selectBackend()`. |
| `src/main/updater/electron-backend.ts` | **Create.** The only file importing `electron-updater`. |
| `src/main/updater/service.ts` | **Create.** State machine, timers, emit. Backend injected. |
| `src/shared/types.ts` | **Modify.** Add `UpdateStatus`, `UpdateState`. |
| `src/shared/ipc.ts` | **Modify.** Add 5 channels + 2 zod schemas. |
| `src/main/ipc/handlers.ts` | **Modify.** Add `registerUpdateHandlers()`. |
| `src/main/index.ts` | **Modify.** Construct + start the service. |
| `src/preload/index.ts` | **Modify.** Add the `updates` bridge namespace. |
| `src/renderer/state/store.ts` | **Modify.** `update` slice + `loadUpdates()`. |
| `src/renderer/app/UpdateChip.tsx` | **Create.** The quiet chip. |
| `src/renderer/sessions/Sidebar.tsx` | **Modify.** Render the chip in `sidebar-foot`. |
| `src/renderer/settings/SettingsDialog.tsx` | **Modify.** Add the Updates section. |
| `electron-builder.yml` | **Modify.** Add the `publish` provider. |
| `.github/workflows/release.yml` | **Modify.** Upload `release/latest*.yml`. |

---

### Task 1: Update policy (pure logic)

**Files:**
- Create: `src/main/updater/policy.ts`
- Test: `tests/unit/updater-policy.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `REPO_OWNER`, `REPO_NAME`, `RELEASES_API_URL`, `CHECK_INTERVAL_MS`, `FIRST_CHECK_DELAY_MS`, `canAutoInstall(platform: string, isPackaged: boolean): boolean`, `normalizeVersion(raw: string): string`, `isNewerVersion(current: string, candidate: string): boolean`, `releaseUrlFor(version: string): string`, `isCheckDue(lastCheckedAt: number | undefined, now: number, intervalMs?: number): boolean`, `class UpdateError extends Error` with `readonly code: UpdateErrorCode`, `type UpdateErrorCode = 'offline' | 'rate-limited' | 'integrity' | 'unsupported' | 'unknown'`, `updateErrorMessage(err: unknown): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/updater-policy.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  canAutoInstall,
  isCheckDue,
  isNewerVersion,
  normalizeVersion,
  releaseUrlFor,
  updateErrorMessage,
  UpdateError,
  CHECK_INTERVAL_MS,
} from '../../src/main/updater/policy.js'

describe('canAutoInstall', () => {
  it('allows packaged Windows and Linux', () => {
    expect(canAutoInstall('win32', true)).toBe(true)
    expect(canAutoInstall('linux', true)).toBe(true)
  })

  it('refuses macOS because unsigned builds cannot be auto-installed', () => {
    expect(canAutoInstall('darwin', true)).toBe(false)
  })

  it('refuses every platform when unpackaged, since electron-updater throws there', () => {
    expect(canAutoInstall('win32', false)).toBe(false)
    expect(canAutoInstall('linux', false)).toBe(false)
    expect(canAutoInstall('darwin', false)).toBe(false)
  })
})

describe('normalizeVersion', () => {
  it('strips a leading v and surrounding whitespace', () => {
    expect(normalizeVersion(' v1.2.3 ')).toBe('1.2.3')
    expect(normalizeVersion('1.2.3')).toBe('1.2.3')
  })
})

describe('isNewerVersion', () => {
  it('detects a newer patch, minor, and major', () => {
    expect(isNewerVersion('1.2.3', '1.2.4')).toBe(true)
    expect(isNewerVersion('1.2.3', '1.3.0')).toBe(true)
    expect(isNewerVersion('1.2.3', '2.0.0')).toBe(true)
  })

  it('rejects equal and older versions', () => {
    expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false)
    expect(isNewerVersion('1.2.3', '1.2.2')).toBe(false)
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(false)
  })

  it('compares numerically, not lexically', () => {
    expect(isNewerVersion('0.9.0', '0.10.0')).toBe(true)
    expect(isNewerVersion('0.10.0', '0.9.0')).toBe(false)
  })

  it('tolerates a v prefix on either side', () => {
    expect(isNewerVersion('v1.2.3', 'v1.2.4')).toBe(true)
  })

  it('ignores prereleases — this app tracks stable releases only', () => {
    expect(isNewerVersion('1.2.3', '1.3.0-beta.1')).toBe(false)
  })

  it('returns false on malformed input rather than throwing', () => {
    expect(isNewerVersion('1.2.3', 'not-a-version')).toBe(false)
    expect(isNewerVersion('', '1.2.3')).toBe(false)
  })
})

describe('releaseUrlFor', () => {
  it('builds the URL from hardcoded repo constants, never from a response', () => {
    expect(releaseUrlFor('0.3.0')).toBe('https://github.com/ishaq-bhojani/Modelith/releases/tag/v0.3.0')
  })

  it('does not double the v prefix', () => {
    expect(releaseUrlFor('v0.3.0')).toBe('https://github.com/ishaq-bhojani/Modelith/releases/tag/v0.3.0')
  })
})

describe('isCheckDue', () => {
  it('is due when nothing has ever been checked', () => {
    expect(isCheckDue(undefined, 1_000)).toBe(true)
  })

  it('is not due before the interval elapses', () => {
    expect(isCheckDue(1_000, 1_000 + CHECK_INTERVAL_MS - 1)).toBe(false)
  })

  it('is due once the interval elapses', () => {
    expect(isCheckDue(1_000, 1_000 + CHECK_INTERVAL_MS)).toBe(true)
  })
})

describe('updateErrorMessage', () => {
  it('maps offline network errors to a connection message', () => {
    const err = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })
    expect(updateErrorMessage(err)).toMatch(/connection/i)
  })

  it('maps a rate-limit UpdateError to a try-later message', () => {
    expect(updateErrorMessage(new UpdateError('rate-limited'))).toMatch(/later/i)
  })

  it('maps a checksum failure to an integrity message', () => {
    expect(updateErrorMessage(new Error('sha512 checksum mismatch'))).toMatch(/verif/i)
  })

  it('never echoes the raw error text, so a response body cannot reach the UI', () => {
    const hostile = new Error('<img src=x onerror=alert(1)> secret-token-abc123')
    const message = updateErrorMessage(hostile)
    expect(message).not.toContain('secret-token-abc123')
    expect(message).not.toContain('<img')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/updater-policy.test.ts`
Expected: FAIL — cannot resolve `src/main/updater/policy.js`.

- [ ] **Step 3: Write the implementation**

Create `src/main/updater/policy.ts`:

```ts
/**
 * Pure update-policy logic. No Electron import, no I/O — everything here is a
 * function of its arguments so the whole file is unit-testable.
 *
 * The repo coordinates live here as constants on purpose: the renderer must
 * never be able to influence where the updater looks, for the same reason
 * src/shared/ipc.ts refuses a renderer-supplied `baseUrl`. A renderer-controlled
 * feed would let compromised UI point the updater at an attacker's binary.
 */
export const REPO_OWNER = 'ishaq-bhojani'
export const REPO_NAME = 'Modelith'
export const RELEASES_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`

/** Wait before the first check so a cold start is never blocked on the network. */
export const FIRST_CHECK_DELAY_MS = 10_000
/** Re-check every 6h so a long-running window still learns about a release. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Whether this platform can download-and-install without user intervention.
 *
 * macOS is excluded: Squirrel.Mac refuses to apply an update to an app that is
 * not code-signed and notarized, and Modelith ships unsigned. Unpackaged builds
 * are excluded because electron-updater throws outright when not packaged —
 * that covers development and every e2e run.
 */
export function canAutoInstall(platform: string, isPackaged: boolean): boolean {
  if (!isPackaged) return false
  return platform === 'win32' || platform === 'linux'
}

export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/, '')
}

function parseVersion(raw: string): [number, number, number] | null {
  // Deliberately strict: a prerelease suffix (1.3.0-beta.1) fails to match and
  // is therefore never treated as newer. This app tracks stable releases only.
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(normalizeVersion(raw))
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function isNewerVersion(current: string, candidate: string): boolean {
  const from = parseVersion(current)
  const to = parseVersion(candidate)
  if (!from || !to) return false
  for (let i = 0; i < 3; i += 1) {
    if (to[i]! > from[i]!) return true
    if (to[i]! < from[i]!) return false
  }
  return false
}

export function releaseUrlFor(version: string): string {
  return `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/v${normalizeVersion(version)}`
}

export function isCheckDue(
  lastCheckedAt: number | undefined,
  now: number,
  intervalMs: number = CHECK_INTERVAL_MS,
): boolean {
  if (lastCheckedAt === undefined) return true
  return now - lastCheckedAt >= intervalMs
}

export type UpdateErrorCode = 'offline' | 'rate-limited' | 'integrity' | 'unsupported' | 'unknown'

/** A failure with a known shape, so messaging never has to guess from free text. */
export class UpdateError extends Error {
  constructor(readonly code: UpdateErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'UpdateError'
  }
}

const OFFLINE_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'ETIMEDOUT'])

function inferCode(err: unknown): UpdateErrorCode {
  if (err instanceof UpdateError) return err.code
  const code = (err as { code?: unknown } | null)?.code
  if (typeof code === 'string' && OFFLINE_CODES.has(code)) return 'offline'
  const text = err instanceof Error ? err.message.toLowerCase() : ''
  if (text.includes('sha512') || text.includes('checksum')) return 'integrity'
  return 'unknown'
}

/**
 * Maps a failure to user-facing copy. The result is ALWAYS one of these fixed
 * strings — the original error text is inspected but never returned, so a
 * response body (or anything an attacker controls) cannot reach the DOM.
 */
export function updateErrorMessage(err: unknown): string {
  switch (inferCode(err)) {
    case 'offline':
      return 'Could not reach GitHub. Check your connection.'
    case 'rate-limited':
      return 'GitHub rate limit reached. Try again later.'
    case 'integrity':
      return 'The download could not be verified and was discarded.'
    case 'unsupported':
      return 'This platform cannot install updates automatically.'
    default:
      return 'The update check failed.'
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/updater-policy.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/main/updater/policy.ts tests/unit/updater-policy.test.ts
git commit -m "feat(updater): pure update policy (version compare, cadence, error mapping)"
```

---

### Task 2: Shared types and IPC contract

**Files:**
- Modify: `src/shared/types.ts` (append)
- Modify: `src/shared/ipc.ts` (add to `CHANNELS`, append schemas)
- Test: `tests/unit/updater-ipc-contract.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `UpdateStatus`, `UpdateState` (from `types.ts`); `CHANNELS.updatesGet | updatesCheck | updatesInstall | updatesSetEnabled | updatesChanged`, `UpdateStateSchema`, `UpdatesSetEnabledSchema` (from `ipc.ts`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/updater-ipc-contract.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CHANNELS, UpdateStateSchema, UpdatesSetEnabledSchema } from '../../src/shared/ipc.js'

describe('update IPC channels', () => {
  it('uses the existing namespaced naming convention', () => {
    expect(CHANNELS.updatesGet).toBe('updates:get')
    expect(CHANNELS.updatesCheck).toBe('updates:check')
    expect(CHANNELS.updatesInstall).toBe('updates:install')
    expect(CHANNELS.updatesSetEnabled).toBe('updates:set-enabled')
    expect(CHANNELS.updatesChanged).toBe('updates:changed')
  })
})

describe('UpdateStateSchema', () => {
  const minimal = {
    status: 'idle',
    canAutoInstall: false,
    currentVersion: '0.2.0',
    enabled: true,
    manualCheck: false,
  }

  it('accepts a minimal state', () => {
    expect(UpdateStateSchema.parse(minimal)).toMatchObject(minimal)
  })

  it('accepts a fully populated state', () => {
    const full = {
      ...minimal,
      status: 'ready',
      latestVersion: '0.3.0',
      percent: 100,
      releaseUrl: 'https://github.com/ishaq-bhojani/Modelith/releases/tag/v0.3.0',
      message: 'done',
      lastCheckedAt: 1_700_000_000_000,
    }
    expect(UpdateStateSchema.parse(full)).toMatchObject(full)
  })

  it('rejects an unknown status', () => {
    expect(() => UpdateStateSchema.parse({ ...minimal, status: 'installing' })).toThrow()
  })

  it('rejects a percent outside 0-100', () => {
    expect(() => UpdateStateSchema.parse({ ...minimal, percent: 101 })).toThrow()
    expect(() => UpdateStateSchema.parse({ ...minimal, percent: -1 })).toThrow()
  })
})

describe('UpdatesSetEnabledSchema', () => {
  it('accepts a boolean', () => {
    expect(UpdatesSetEnabledSchema.parse({ enabled: false })).toEqual({ enabled: false })
  })

  it('rejects a non-boolean', () => {
    expect(() => UpdatesSetEnabledSchema.parse({ enabled: 'yes' })).toThrow()
  })

  it('exposes no field that could redirect the update feed', () => {
    const parsed = UpdatesSetEnabledSchema.parse({ enabled: true, url: 'https://evil.test' })
    expect(parsed).toEqual({ enabled: true })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/updater-ipc-contract.test.ts`
Expected: FAIL — `UpdateStateSchema` is not exported.

- [ ] **Step 3: Add the channels and schemas**

In `src/shared/ipc.ts`, add these entries to the `CHANNELS` object, immediately after the `settingsSet` line:

```ts
  updatesGet: 'updates:get',
  updatesCheck: 'updates:check',
  updatesInstall: 'updates:install',
  updatesSetEnabled: 'updates:set-enabled',
  updatesChanged: 'updates:changed',
```

Then append at the end of `src/shared/ipc.ts`:

```ts
// Software updates (auto-update spec). Note there is deliberately no field here
// for a feed URL, owner, or repo: those are constants in
// src/main/updater/policy.ts. A renderer-supplied feed would let compromised UI
// point the updater at an attacker's binary — the same reasoning that keeps
// `baseUrl` off SendSchema above.
export const UpdateStatusSchema = z.enum([
  'idle', 'checking', 'available', 'downloading', 'ready', 'error',
])

export const UpdateStateSchema = z.object({
  status: UpdateStatusSchema,
  canAutoInstall: z.boolean(),
  currentVersion: z.string(),
  latestVersion: z.string().optional(),
  percent: z.number().min(0).max(100).optional(),
  releaseUrl: z.string().optional(),
  message: z.string().optional(),
  enabled: z.boolean(),
  lastCheckedAt: z.number().optional(),
  manualCheck: z.boolean(),
})

export const UpdatesSetEnabledSchema = z.object({ enabled: z.boolean() })
```

Append to `src/shared/types.ts`:

```ts
/** Software-update lifecycle (auto-update spec). Owned by main, mirrored into
 *  the renderer store; the renderer never mutates it directly. */
export type UpdateStatus =
  | 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'

export interface UpdateState {
  status: UpdateStatus
  /** False on macOS (unsigned builds cannot auto-install) and when unpackaged. */
  canAutoInstall: boolean
  currentVersion: string
  latestVersion?: string
  /** Download progress, 0–100. */
  percent?: number
  /** Built by main from the version tag; never taken from an API response. */
  releaseUrl?: string
  /** Our own copy — never a response body. */
  message?: string
  enabled: boolean
  lastCheckedAt?: number
  /** True when the current cycle began with an explicit "Check now", so the
   *  chip can stay silent on a background failure but report a requested one. */
  manualCheck: boolean
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/updater-ipc-contract.test.ts && npm run typecheck`
Expected: PASS and a clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc.ts src/shared/types.ts tests/unit/updater-ipc-contract.test.ts
git commit -m "feat(updater): UpdateState type and IPC channel contract"
```

---

### Task 3: Backend interface, CheckOnly, Null, and Fake backends

**Files:**
- Create: `src/main/updater/backend.ts`
- Test: `tests/unit/updater-backend.test.ts`

**Interfaces:**
- Consumes: `RELEASES_API_URL`, `normalizeVersion`, `UpdateError` from `./policy.js`.
- Produces:
  - `interface UpdateCheckResult { version: string }`
  - `type UpdaterBackendEvent = 'progress' | 'downloaded' | 'error'`
  - `interface UpdaterBackend { check(): Promise<UpdateCheckResult | null>; download(): Promise<void>; quitAndInstall(): void; on(event: UpdaterBackendEvent, cb: (payload: unknown) => void): void }`
  - `class CheckOnlyBackend implements UpdaterBackend` — constructor `(fetchImpl?: typeof fetch)`
  - `class NullBackend implements UpdaterBackend`
  - `class FakeUpdaterBackend implements UpdaterBackend` — constructor `(version?: string)`

`ElectronUpdaterBackend` and `selectBackend()` arrive in Task 5; this task must not import `electron-updater`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/updater-backend.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { CheckOnlyBackend, NullBackend, FakeUpdaterBackend } from '../../src/main/updater/backend.js'
import { UpdateError } from '../../src/main/updater/policy.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('CheckOnlyBackend', () => {
  it('reports the latest version from the release tag', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tag_name: 'v0.3.0' }))
    const backend = new CheckOnlyBackend(fetchImpl as unknown as typeof fetch)
    expect(await backend.check()).toEqual({ version: '0.3.0' })
  })

  it('requests the hardcoded repo endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tag_name: 'v0.3.0' }))
    await new CheckOnlyBackend(fetchImpl as unknown as typeof fetch).check()
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://api.github.com/repos/ishaq-bhojani/Modelith/releases/latest',
    )
  })

  it('treats 404 (no release yet) as "no update", not an error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 404 }))
    expect(await new CheckOnlyBackend(fetchImpl as unknown as typeof fetch).check()).toBeNull()
  })

  it('raises a rate-limited UpdateError on 403 and 429', async () => {
    for (const status of [403, 429]) {
      const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status }))
      const backend = new CheckOnlyBackend(fetchImpl as unknown as typeof fetch)
      await expect(backend.check()).rejects.toMatchObject({ code: 'rate-limited' })
    }
  })

  it('raises an error carrying only the status code, never the response body', async () => {
    // mockImplementation (not mockResolvedValue): a Response body can only be
    // consumed once, so each call needs its own instance.
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response('secret-token-abc123', { status: 500 })))
    const backend = new CheckOnlyBackend(fetchImpl as unknown as typeof fetch)
    const err = await backend.check().catch((e: unknown) => e)
    expect(String(err)).toMatch(/500/)
    expect(String(err)).not.toContain('secret-token-abc123')
  })

  it('never leaks the body when a 2xx response is not valid JSON', async () => {
    // The !ok branch short-circuits before .json(), so this is the only path
    // that exercises the parse guard — and it is where the leak actually was.
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response('secret-token-abc123', { status: 200 })))
    const backend = new CheckOnlyBackend(fetchImpl as unknown as typeof fetch)
    const err = await backend.check().catch((e: unknown) => e)
    expect(String(err)).not.toContain('secret-token-abc123')
  })

  it('returns null when the payload has no usable tag', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tag_name: 42 }))
    expect(await new CheckOnlyBackend(fetchImpl as unknown as typeof fetch).check()).toBeNull()
  })

  it('refuses to download, since this platform cannot install automatically', async () => {
    const backend = new CheckOnlyBackend(vi.fn() as unknown as typeof fetch)
    await expect(backend.download()).rejects.toBeInstanceOf(UpdateError)
  })
})

describe('NullBackend', () => {
  it('never reports an update, so unpackaged builds stay idle', async () => {
    expect(await new NullBackend().check()).toBeNull()
  })

  it('refuses to download', async () => {
    await expect(new NullBackend().download()).rejects.toBeInstanceOf(UpdateError)
  })
})

describe('FakeUpdaterBackend', () => {
  it('reports a far-future version so e2e always sees an update', async () => {
    expect(await new FakeUpdaterBackend().check()).toEqual({ version: '99.0.0' })
  })

  it('emits progress then downloaded when asked to download', async () => {
    const backend = new FakeUpdaterBackend()
    const events: string[] = []
    backend.on('progress', () => events.push('progress'))
    backend.on('downloaded', () => events.push('downloaded'))
    await backend.download()
    expect(events).toEqual(['progress', 'downloaded'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/updater-backend.test.ts`
Expected: FAIL — cannot resolve `src/main/updater/backend.js`.

- [ ] **Step 3: Write the implementation**

Create `src/main/updater/backend.ts`:

```ts
import { RELEASES_API_URL, UpdateError, normalizeVersion } from './policy.js'

export interface UpdateCheckResult {
  version: string
}

export type UpdaterBackendEvent = 'progress' | 'downloaded' | 'error'

/**
 * The seam the UpdaterService is written against. Three implementations live
 * here (check-only, null, fake); the electron-updater one lives in
 * electron-backend.ts so this file stays importable without the dependency.
 */
export interface UpdaterBackend {
  /** Resolves with the latest version, or null when there is nothing newer. */
  check(): Promise<UpdateCheckResult | null>
  download(): Promise<void>
  quitAndInstall(): void
  on(event: UpdaterBackendEvent, cb: (payload: unknown) => void): void
}

/** Minimal event plumbing shared by the non-electron-updater backends. */
class EventEmitterBase {
  private readonly listeners = new Map<UpdaterBackendEvent, ((payload: unknown) => void)[]>()

  on(event: UpdaterBackendEvent, cb: (payload: unknown) => void): void {
    const existing = this.listeners.get(event) ?? []
    existing.push(cb)
    this.listeners.set(event, existing)
  }

  protected emit(event: UpdaterBackendEvent, payload?: unknown): void {
    for (const cb of this.listeners.get(event) ?? []) cb(payload)
  }
}

/**
 * macOS. Squirrel.Mac refuses to apply an update to an unsigned app, so this
 * backend only ever ANSWERS THE QUESTION "is there something newer?" — it never
 * downloads. Because nothing is executed, it carries no integrity burden.
 */
export class CheckOnlyBackend extends EventEmitterBase implements UpdaterBackend {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {
    super()
  }

  async check(): Promise<UpdateCheckResult | null> {
    const response = await this.fetchImpl(RELEASES_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    // No release published yet is a normal state, not a failure.
    if (response.status === 404) return null
    if (response.status === 403 || response.status === 429) {
      throw new UpdateError('rate-limited')
    }
    // Only the status code goes into the message — never the body, which is
    // remote-controlled text that must not reach the UI.
    if (!response.ok) throw new Error(`GitHub responded ${response.status}`)

    let body: { tag_name?: unknown }
    try {
      body = (await response.json()) as { tag_name?: unknown }
    } catch {
      // response.json() embeds the raw body text in a SyntaxError when the
      // payload isn't valid JSON (e.g. a captive portal, proxy, or WAF
      // returning a 200 HTML page). Re-throw without that text — same
      // never-leak-the-body posture as the !response.ok branch above.
      throw new Error(`GitHub returned an unparsable response (status ${response.status})`)
    }
    if (typeof body.tag_name !== 'string' || body.tag_name.length === 0) return null
    return { version: normalizeVersion(body.tag_name) }
  }

  download(): Promise<void> {
    return Promise.reject(new UpdateError('unsupported'))
  }

  quitAndInstall(): void {
    throw new UpdateError('unsupported')
  }
}

/** Unpackaged builds — development and every e2e run. electron-updater throws
 *  when not packaged, so the service is given a backend that does nothing. */
export class NullBackend extends EventEmitterBase implements UpdaterBackend {
  check(): Promise<UpdateCheckResult | null> {
    return Promise.resolve(null)
  }

  download(): Promise<void> {
    return Promise.reject(new UpdateError('unsupported'))
  }

  quitAndInstall(): void {
    throw new UpdateError('unsupported')
  }
}

/**
 * Drives the e2e suite (MODELITH_FAKE_UPDATER=1), mirroring the fake-provider
 * pattern in src/main/providers/registry.ts. Reports a version nothing can
 * exceed, then "downloads" instantly.
 */
export class FakeUpdaterBackend extends EventEmitterBase implements UpdaterBackend {
  constructor(private readonly version = '99.0.0') {
    super()
  }

  check(): Promise<UpdateCheckResult | null> {
    return Promise.resolve({ version: this.version })
  }

  download(): Promise<void> {
    this.emit('progress', 50)
    this.emit('downloaded')
    return Promise.resolve()
  }

  quitAndInstall(): void {
    // Nothing to do: the e2e suite asserts the UI reached "ready", and must
    // never actually restart the app under test.
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/updater-backend.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/updater/backend.ts tests/unit/updater-backend.test.ts
git commit -m "feat(updater): backend interface with check-only, null, and fake implementations"
```

---

### Task 4: UpdaterService state machine

**Files:**
- Create: `src/main/updater/service.ts`
- Test: `tests/unit/updater-service.test.ts`

**Interfaces:**
- Consumes: `UpdaterBackend` from `./backend.js`; `CHECK_INTERVAL_MS`, `FIRST_CHECK_DELAY_MS`, `isNewerVersion`, `releaseUrlFor`, `updateErrorMessage` from `./policy.js`; `UpdateState` from `../../shared/types.js`.
- Produces:
  - `interface UpdaterServiceOptions { backend: UpdaterBackend; currentVersion: string; canAutoInstall: boolean; enabled: boolean; emit: (state: UpdateState) => void; now?: () => number; persistEnabled?: (enabled: boolean) => Promise<void> }`
  - `class UpdaterService` with `getState(): UpdateState`, `start(): void`, `stop(): void`, `check(manual?: boolean): Promise<void>`, `install(): void`, `setEnabled(enabled: boolean): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/updater-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { UpdaterService } from '../../src/main/updater/service.js'
import type { UpdaterBackend, UpdateCheckResult, UpdaterBackendEvent } from '../../src/main/updater/backend.js'
import type { UpdateState } from '../../src/shared/types.js'
import { CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS, UpdateError } from '../../src/main/updater/policy.js'

class FakeBackend implements UpdaterBackend {
  checkResult: UpdateCheckResult | null = { version: '0.3.0' }
  checkError: unknown = null
  downloadError: unknown = null
  checkCalls = 0
  downloadCalls = 0
  quitCalls = 0
  private readonly listeners = new Map<UpdaterBackendEvent, ((p: unknown) => void)[]>()

  async check(): Promise<UpdateCheckResult | null> {
    this.checkCalls += 1
    if (this.checkError) throw this.checkError
    return this.checkResult
  }

  async download(): Promise<void> {
    this.downloadCalls += 1
    if (this.downloadError) throw this.downloadError
  }

  quitAndInstall(): void {
    this.quitCalls += 1
  }

  on(event: UpdaterBackendEvent, cb: (p: unknown) => void): void {
    const list = this.listeners.get(event) ?? []
    list.push(cb)
    this.listeners.set(event, list)
  }

  fire(event: UpdaterBackendEvent, payload?: unknown): void {
    for (const cb of this.listeners.get(event) ?? []) cb(payload)
  }
}

function makeService(overrides: Partial<{
  backend: FakeBackend; canAutoInstall: boolean; enabled: boolean; currentVersion: string
  persistEnabled: (enabled: boolean) => Promise<void>
}> = {}) {
  const backend = overrides.backend ?? new FakeBackend()
  const states: UpdateState[] = []
  const service = new UpdaterService({
    backend,
    currentVersion: overrides.currentVersion ?? '0.2.0',
    canAutoInstall: overrides.canAutoInstall ?? true,
    enabled: overrides.enabled ?? true,
    emit: (s) => states.push(s),
    now: () => 1_000,
    ...(overrides.persistEnabled ? { persistEnabled: overrides.persistEnabled } : {}),
  })
  return { service, backend, states }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('UpdaterService — happy path', () => {
  it('starts idle at the current version', () => {
    const { service } = makeService()
    expect(service.getState()).toMatchObject({ status: 'idle', currentVersion: '0.2.0', enabled: true })
  })

  it('moves through checking to available and records the release URL', async () => {
    const { service, states } = makeService({ canAutoInstall: false })
    await service.check()
    // Assert the transition boundaries, not the exact emit count: `check()`
    // patches lastCheckedAt mid-flight, which legitimately emits 'checking'
    // more than once.
    expect(states[0]!.status).toBe('checking')
    expect(states.at(-1)!.status).toBe('available')
    expect(states.some((s) => s.status === 'checking')).toBe(true)
    expect(service.getState()).toMatchObject({
      status: 'available',
      latestVersion: '0.3.0',
      releaseUrl: 'https://github.com/ishaq-bhojani/Modelith/releases/tag/v0.3.0',
    })
  })

  it('auto-downloads when the platform can install', async () => {
    const { service, backend } = makeService({ canAutoInstall: true })
    await service.check()
    expect(backend.downloadCalls).toBe(1)
    expect(service.getState().status).toBe('downloading')
  })

  it('reaches ready when the backend reports the download finished', async () => {
    const { service, backend } = makeService({ canAutoInstall: true })
    await service.check()
    backend.fire('downloaded')
    expect(service.getState()).toMatchObject({ status: 'ready', percent: 100 })
  })

  it('tracks download progress', async () => {
    const { service, backend } = makeService({ canAutoInstall: true })
    await service.check()
    backend.fire('progress', 42)
    expect(service.getState().percent).toBe(42)
  })

  it('records lastCheckedAt on a successful check', async () => {
    const { service } = makeService()
    await service.check()
    expect(service.getState().lastCheckedAt).toBe(1_000)
  })
})

describe('UpdaterService — macOS (cannot auto-install)', () => {
  it('stops at available and never downloads', async () => {
    const { service, backend } = makeService({ canAutoInstall: false })
    await service.check()
    expect(service.getState().status).toBe('available')
    expect(backend.downloadCalls).toBe(0)
  })
})

describe('UpdaterService — no update', () => {
  it('returns to idle when the backend reports nothing newer', async () => {
    const backend = new FakeBackend()
    backend.checkResult = null
    const { service } = makeService({ backend })
    await service.check()
    expect(service.getState()).toMatchObject({ status: 'idle', latestVersion: undefined })
  })

  it('returns to idle when the reported version is not newer', async () => {
    const backend = new FakeBackend()
    backend.checkResult = { version: '0.1.0' }
    const { service } = makeService({ backend })
    await service.check()
    expect(service.getState().status).toBe('idle')
  })
})

describe('UpdaterService — failures never throw', () => {
  it('turns a check failure into error state instead of rejecting', async () => {
    const backend = new FakeBackend()
    backend.checkError = new UpdateError('rate-limited')
    const { service } = makeService({ backend })
    await expect(service.check()).resolves.toBeUndefined()
    expect(service.getState()).toMatchObject({ status: 'error' })
    expect(service.getState().message).toMatch(/later/i)
  })

  it('turns a download failure into error state', async () => {
    const backend = new FakeBackend()
    backend.downloadError = new Error('sha512 mismatch')
    const { service } = makeService({ backend })
    await service.check()
    expect(service.getState()).toMatchObject({ status: 'error' })
    expect(service.getState().message).toMatch(/verif/i)
  })

  it('turns a backend error event into error state', async () => {
    const { service, backend } = makeService()
    backend.fire('error', new Error('boom'))
    expect(service.getState().status).toBe('error')
  })

  it('never puts raw error text into the message', async () => {
    const backend = new FakeBackend()
    backend.checkError = new Error('token-abc123')
    const { service } = makeService({ backend })
    await service.check()
    expect(service.getState().message).not.toContain('token-abc123')
  })
})

describe('UpdaterService — manualCheck flag', () => {
  it('is false for a background check', async () => {
    const backend = new FakeBackend()
    backend.checkError = new Error('offline')
    const { service } = makeService({ backend })
    await service.check()
    expect(service.getState().manualCheck).toBe(false)
  })

  it('is true for a user-requested check', async () => {
    const backend = new FakeBackend()
    backend.checkError = new Error('offline')
    const { service } = makeService({ backend })
    await service.check(true)
    expect(service.getState().manualCheck).toBe(true)
  })
})

describe('UpdaterService — enablement', () => {
  it('skips a background check when disabled', async () => {
    const { service, backend } = makeService({ enabled: false })
    await service.check()
    expect(backend.checkCalls).toBe(0)
  })

  it('still honours an explicit manual check when disabled', async () => {
    const { service, backend } = makeService({ enabled: false })
    await service.check(true)
    expect(backend.checkCalls).toBe(1)
  })

  it('persists the toggle', async () => {
    const persistEnabled = vi.fn().mockResolvedValue(undefined)
    const { service } = makeService({ persistEnabled })
    await service.setEnabled(false)
    expect(persistEnabled).toHaveBeenCalledWith(false)
    expect(service.getState().enabled).toBe(false)
  })

  it('does not schedule checks when start() runs while disabled', () => {
    const { service, backend } = makeService({ enabled: false })
    service.start()
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS + CHECK_INTERVAL_MS)
    expect(backend.checkCalls).toBe(0)
  })
})

describe('UpdaterService — scheduling', () => {
  it('checks once after the startup delay, not immediately', () => {
    const { service, backend } = makeService()
    service.start()
    expect(backend.checkCalls).toBe(0)
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS)
    expect(backend.checkCalls).toBe(1)
    service.stop()
  })

  it('re-checks on the interval', async () => {
    // canAutoInstall: false on purpose — this test is about scheduling, not
    // downloading. With it true, check() parks in 'downloading' forever
    // (FakeBackend.download() never fires 'downloaded'), and the re-entrancy
    // guard then swallows every later tick.
    const { service, backend } = makeService({ canAutoInstall: false })
    service.start()
    // advanceTimersByTimeAsync (not advanceTimersByTime) flushes microtasks
    // between ticks, so each check() settles before the next interval fires.
    // With the synchronous variant the awaited check never resolves, the
    // guard swallows every later tick, and this would assert the guard
    // rather than the schedule.
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS)
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    expect(backend.checkCalls).toBe(3)
    service.stop()
  })

  it('stops firing after stop()', () => {
    const { service, backend } = makeService()
    service.start()
    service.stop()
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS + CHECK_INTERVAL_MS * 3)
    expect(backend.checkCalls).toBe(0)
  })

  it('ignores a re-entrant check while one is in flight', async () => {
    const { service, backend } = makeService()
    const first = service.check()
    const second = service.check()
    await Promise.all([first, second])
    expect(backend.checkCalls).toBe(1)
  })
})

describe('UpdaterService — install', () => {
  it('installs only from the ready state', async () => {
    const { service, backend } = makeService()
    service.install()
    expect(backend.quitCalls).toBe(0)
    await service.check()
    backend.fire('downloaded')
    service.install()
    expect(backend.quitCalls).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/updater-service.test.ts`
Expected: FAIL — cannot resolve `src/main/updater/service.js`.

- [ ] **Step 3: Write the implementation**

Create `src/main/updater/service.ts`:

```ts
import type { UpdateState } from '../../shared/types.js'
import type { UpdaterBackend } from './backend.js'
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  isNewerVersion,
  releaseUrlFor,
  updateErrorMessage,
} from './policy.js'

export interface UpdaterServiceOptions {
  backend: UpdaterBackend
  currentVersion: string
  canAutoInstall: boolean
  enabled: boolean
  emit: (state: UpdateState) => void
  now?: () => number
  persistEnabled?: (enabled: boolean) => Promise<void>
}

/**
 * Owns the update lifecycle and the single UpdateState the renderer mirrors.
 *
 * The backend is injected rather than constructed here, which is what keeps
 * this state machine testable: the whole class is exercised against a fake with
 * no Electron, no network, and no packaged app.
 *
 * Mirrors the `streamChat` golden rule — nothing here throws to its caller.
 * Every failure lands in `status: 'error'` with a message we authored.
 */
export class UpdaterService {
  private state: UpdateState
  private readonly backend: UpdaterBackend
  private readonly emit: (state: UpdateState) => void
  private readonly now: () => number
  private readonly persistEnabled: (enabled: boolean) => Promise<void>
  private firstCheckTimer: ReturnType<typeof setTimeout> | undefined
  private intervalTimer: ReturnType<typeof setInterval> | undefined

  constructor(options: UpdaterServiceOptions) {
    this.backend = options.backend
    this.emit = options.emit
    this.now = options.now ?? (() => Date.now())
    this.persistEnabled = options.persistEnabled ?? (async () => {})
    this.state = {
      status: 'idle',
      canAutoInstall: options.canAutoInstall,
      currentVersion: options.currentVersion,
      enabled: options.enabled,
      manualCheck: false,
    }

    this.backend.on('progress', (payload) => {
      if (this.state.status !== 'downloading') return
      if (typeof payload === 'number') this.patch({ percent: Math.max(0, Math.min(100, payload)) })
    })
    this.backend.on('downloaded', () => this.patch({ status: 'ready', percent: 100 }))
    this.backend.on('error', (payload) => this.fail(payload))
  }

  getState(): UpdateState {
    return { ...this.state }
  }

  start(): void {
    if (!this.state.enabled) return
    this.stop()
    // Delayed rather than immediate: a cold start must never wait on the network.
    this.firstCheckTimer = setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS)
    this.intervalTimer = setInterval(() => void this.check(), CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (this.firstCheckTimer) clearTimeout(this.firstCheckTimer)
    if (this.intervalTimer) clearInterval(this.intervalTimer)
    this.firstCheckTimer = undefined
    this.intervalTimer = undefined
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.patch({ enabled })
    await this.persistEnabled(enabled)
    if (enabled) this.start()
    else this.stop()
  }

  /**
   * @param manual true when the user pressed "Check now". A manual check runs
   * even while auto-checks are disabled, and marks the state so the chip may
   * surface a failure the user explicitly asked for.
   */
  async check(manual = false): Promise<void> {
    if (!this.state.enabled && !manual) return
    // A second check while one is in flight would double-download.
    if (this.state.status === 'checking' || this.state.status === 'downloading') return

    this.patch({ status: 'checking', manualCheck: manual, message: undefined })
    try {
      const result = await this.backend.check()
      this.patch({ lastCheckedAt: this.now() })

      if (!result || !isNewerVersion(this.state.currentVersion, result.version)) {
        this.patch({ status: 'idle', latestVersion: undefined })
        return
      }

      this.patch({
        status: 'available',
        latestVersion: result.version,
        releaseUrl: releaseUrlFor(result.version),
      })

      // macOS stops here: unsigned builds cannot be auto-installed, so the UI
      // links to the release page instead.
      if (!this.state.canAutoInstall) return

      this.patch({ status: 'downloading', percent: 0 })
      await this.backend.download()
      // Readiness is derived from download() RESOLVING, not only from the
      // 'downloaded' event. electron-updater's downloadUpdate() resolves once
      // the download is complete, and a backend that resolves without emitting
      // would otherwise park state in 'downloading' forever — after which the
      // re-entrancy guard above swallows every future check, scheduled or
      // manual, with no error and no recovery.
      //
      // Only when status is STILL 'downloading': a synchronous 'downloaded'
      // may already have moved it to 'ready', or an 'error' to 'error';
      // neither may be clobbered. Read via getState() — TS's control-flow
      // narrowing wrongly carries the early-return guard's exclusion of
      // 'downloading' through to `this.state.status` here.
      if (this.getState().status === 'downloading') {
        this.patch({ status: 'ready', percent: 100 })
      }
    } catch (err) {
      this.fail(err)
    }
  }

  install(): void {
    if (this.state.status !== 'ready') return
    try {
      this.backend.quitAndInstall()
    } catch (err) {
      this.fail(err)
    }
  }

  private patch(partial: Partial<UpdateState>): void {
    this.state = { ...this.state, ...partial }
    this.emit(this.getState())
  }

  private fail(err: unknown): void {
    this.patch({ status: 'error', message: updateErrorMessage(err) })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/updater-service.test.ts`
Expected: PASS, 24/24.

> **Timer tests:** only `'re-checks on the interval'` needs `advanceTimersByTimeAsync`. The other three timer cases are correct synchronously — `check()` increments the backend counter before its first `await`, so a sync advance is enough to observe them. Do not convert those to async.

- [ ] **Step 5: Commit**

```bash
git add src/main/updater/service.ts tests/unit/updater-service.test.ts
git commit -m "feat(updater): UpdaterService state machine with injected backend"
```

---

### Task 5: electron-updater backend, dependency, and packaging config

**Files:**
- Create: `src/main/updater/electron-backend.ts`
- Modify: `src/main/updater/backend.ts` (append `selectBackend`)
- Modify: `package.json` (add dependency)
- Modify: `electron-builder.yml` (add `publish`)
- Test: `tests/unit/updater-select-backend.test.ts`

**Interfaces:**
- Consumes: `UpdaterBackend` from `./backend.js`.
- Produces: `class ElectronUpdaterBackend implements UpdaterBackend` (from `electron-backend.ts`); `selectBackend(opts: { platform: string; isPackaged: boolean; fake?: boolean }): UpdaterBackend` (from `backend.ts`).

`selectBackend` must NOT import `ElectronUpdaterBackend` itself — lazily or otherwise. It takes an optional `electronBackendFactory` parameter instead, which `main` (see `src/main/ipc/handlers.ts`) supplies by statically importing `electron-backend.js`. This keeps unit tests that import `backend.ts` from ever loading `electron-updater`, which requires a real Electron runtime — see the packaging note in Step 5 below for why a `createRequire`-based lazy import does not work in a packaged build.

- [ ] **Step 1: Install the dependency**

```bash
npm install electron-updater
```

Verify it landed in `dependencies` (not `devDependencies`) — it ships inside the packaged app.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/updater-select-backend.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { selectBackend, CheckOnlyBackend, NullBackend, FakeUpdaterBackend } from '../../src/main/updater/backend.js'

describe('selectBackend', () => {
  it('returns the fake backend when the e2e flag is set, whatever the platform', () => {
    expect(selectBackend({ platform: 'win32', isPackaged: false, fake: true })).toBeInstanceOf(FakeUpdaterBackend)
    expect(selectBackend({ platform: 'darwin', isPackaged: true, fake: true })).toBeInstanceOf(FakeUpdaterBackend)
  })

  it('returns the null backend when unpackaged, because electron-updater throws there', () => {
    expect(selectBackend({ platform: 'win32', isPackaged: false })).toBeInstanceOf(NullBackend)
    expect(selectBackend({ platform: 'linux', isPackaged: false })).toBeInstanceOf(NullBackend)
  })

  it('returns the check-only backend on packaged macOS', () => {
    expect(selectBackend({ platform: 'darwin', isPackaged: true })).toBeInstanceOf(CheckOnlyBackend)
  })
})
```

> There is deliberately no unit test asserting the packaged-Windows branch returns `ElectronUpdaterBackend`: constructing it requires a real Electron runtime. That branch is covered by the manual release checklist in the spec.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/updater-select-backend.test.ts`
Expected: FAIL — `selectBackend` is not exported.

- [ ] **Step 4: Write the electron-updater backend**

Create `src/main/updater/electron-backend.ts`:

```ts
// electron-updater is CommonJS; this project is ESM ("type": "module"), so the
// named export cannot be destructured from a static import. Import the default
// and pull `autoUpdater` off it.
import electronUpdater from 'electron-updater'
import type { UpdateCheckResult, UpdaterBackend, UpdaterBackendEvent } from './backend.js'
import { normalizeVersion } from './policy.js'

const { autoUpdater } = electronUpdater

/**
 * Windows (NSIS) and Linux (AppImage). Thin on purpose — everything that could
 * hold a bug lives in service.ts or policy.ts, both of which are unit-tested.
 *
 * electron-updater verifies the download's SHA512 against the signed
 * latest*.yml metadata published beside the installers. That verification is
 * the reason this dependency exists rather than a hand-rolled downloader.
 */
export class ElectronUpdaterBackend implements UpdaterBackend {
  constructor() {
    // We drive downloading from the service so the UI can show `available`
    // before bytes start moving.
    autoUpdater.autoDownload = false
    // A user who ignores the chip still gets the update on their next normal
    // quit — no second prompt, no lost download.
    autoUpdater.autoInstallOnAppQuit = true
  }

  async check(): Promise<UpdateCheckResult | null> {
    const result = await autoUpdater.checkForUpdates()
    const version = result?.updateInfo?.version
    if (typeof version !== 'string' || version.length === 0) return null
    return { version: normalizeVersion(version) }
  }

  async download(): Promise<void> {
    await autoUpdater.downloadUpdate()
  }

  quitAndInstall(): void {
    autoUpdater.quitAndInstall()
  }

  on(event: UpdaterBackendEvent, cb: (payload: unknown) => void): void {
    if (event === 'progress') {
      autoUpdater.on('download-progress', (info: { percent?: number }) => cb(info?.percent ?? 0))
      return
    }
    if (event === 'downloaded') {
      autoUpdater.on('update-downloaded', () => cb(undefined))
      return
    }
    autoUpdater.on('error', (err: unknown) => cb(err))
  }
}
```

- [ ] **Step 5: Add `selectBackend` to `backend.ts`**

Append to `src/main/updater/backend.ts`:

Append to `src/main/updater/backend.ts`:

```ts
/**
 * Picks the one backend this process will use, once, at startup.
 *
 * ElectronUpdaterBackend is INJECTED rather than imported here. Importing it
 * would pull electron-updater into every unit test that touches this module,
 * and electron-updater needs a real Electron runtime. Main supplies the
 * factory (see src/main/ipc/handlers.ts), which can import it statically.
 */
export function selectBackend(options: {
  platform: string
  isPackaged: boolean
  fake?: boolean
  electronBackendFactory?: () => UpdaterBackend
}): UpdaterBackend {
  if (options.fake) return new FakeUpdaterBackend()
  if (!options.isPackaged) return new NullBackend()
  if (options.platform === 'win32' || options.platform === 'linux') {
    return options.electronBackendFactory?.() ?? new NullBackend()
  }
  return new CheckOnlyBackend()
}
```

> **Do NOT lazy-load `electron-backend.js` with `createRequire`.** electron-vite/Rollup bundles the whole main process into a single `out/main/index.js`; a `createRequire`-built `require` is opaque to Rollup, so `electron-backend.ts` is never emitted and the call throws `MODULE_NOT_FOUND` in every packaged build. Verified empirically. Static injection from main is what makes this bundler-safe.

> This repo has no ESLint (no config, no dependency) — do not add `eslint-disable` comments anywhere.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/unit/updater-select-backend.test.ts && npm run typecheck`
Expected: PASS and a clean typecheck.

- [ ] **Step 7: Add the packaging publish provider**

In `electron-builder.yml`, add after the `asar: true` line:

```yaml
# Required for auto-update: this is what makes electron-builder emit the
# latest.yml / latest-linux.yml metadata that electron-updater reads.
#
# !! The `--publish never` flag in package.json's `dist` script is LOAD-BEARING
# because of this block. With a publish provider configured, electron-builder
# implicitly publishes when it sees a git tag — that is exactly what broke the
# v0.2.0 release, putting installers into a separate draft release instead of
# the published one. The workflow's release job owns publishing. Do not remove
# `--publish never`.
publish:
  provider: github
  owner: ishaq-bhojani
  repo: Modelith
```

- [ ] **Step 8: Verify the dist script still suppresses publishing**

Run: `node -e "const p=require('./package.json'); if(!p.scripts.dist.includes('--publish never')) { throw new Error('dist script must keep --publish never'); } console.log('ok');"`
Expected: prints `ok`.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json electron-builder.yml src/main/updater/electron-backend.ts src/main/updater/backend.ts tests/unit/updater-select-backend.test.ts
git commit -m "feat(updater): electron-updater backend and github publish provider

Adding a publish provider makes --publish never load-bearing: it is what
stops electron-builder implicitly publishing on a tag, the bug that shipped
v0.2.0 without installers."
```

---

### Task 6: Main-process wiring and IPC handlers

**Files:**
- Modify: `src/main/ipc/handlers.ts` (add `registerUpdateHandlers`)
- Modify: `src/main/index.ts` (construct + start)
- Test: `tests/unit/updater-handlers.test.ts`

**Interfaces:**
- Consumes: `UpdaterService`, `selectBackend`, `canAutoInstall`, `CHANNELS`, `UpdatesSetEnabledSchema`.
- Produces: `registerUpdateHandlers(getWindow: () => BrowserWindow | undefined): Promise<void>` and `getUpdater(): UpdaterService | undefined`, both exported from `src/main/ipc/handlers.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/updater-handlers.test.ts`. This tests the wiring logic in isolation — the settings round-trip and the emit shape — without booting Electron:

```ts
import { describe, it, expect, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppSettingsStore } from '../../src/main/settings/store.js'
import { UpdaterService } from '../../src/main/updater/service.js'
import { FakeUpdaterBackend } from '../../src/main/updater/backend.js'

async function makeStore(): Promise<AppSettingsStore> {
  const dir = await mkdtemp(join(tmpdir(), 'oc-updates-'))
  return new AppSettingsStore(join(dir, 'settings.json'))
}

describe('updates enablement persistence', () => {
  it('defaults to enabled when the setting has never been written', async () => {
    const store = await makeStore()
    const raw = (await store.get())['updatesEnabled']
    expect(raw === undefined ? true : raw).toBe(true)
  })

  it('round-trips the toggle through the settings store', async () => {
    const store = await makeStore()
    const service = new UpdaterService({
      backend: new FakeUpdaterBackend(),
      currentVersion: '0.2.0',
      canAutoInstall: true,
      enabled: true,
      emit: () => {},
      persistEnabled: async (enabled) => { await store.set({ updatesEnabled: enabled }) },
    })
    await service.setEnabled(false)
    expect((await store.get())['updatesEnabled']).toBe(false)
    await service.setEnabled(true)
    expect((await store.get())['updatesEnabled']).toBe(true)
  })
})

describe('update state emission', () => {
  it('emits a fresh state object on every transition, never a shared reference', async () => {
    const emitted: unknown[] = []
    const service = new UpdaterService({
      backend: new FakeUpdaterBackend(),
      currentVersion: '0.2.0',
      canAutoInstall: true,
      enabled: true,
      emit: (s) => emitted.push(s),
    })
    await service.check()
    expect(emitted.length).toBeGreaterThan(1)
    expect(new Set(emitted).size).toBe(emitted.length)
  })

  it('reports ready after the fake backend completes a download', async () => {
    const service = new UpdaterService({
      backend: new FakeUpdaterBackend(),
      currentVersion: '0.2.0',
      canAutoInstall: true,
      enabled: true,
      emit: () => {},
    })
    await service.check()
    expect(service.getState()).toMatchObject({ status: 'ready', latestVersion: '99.0.0' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails or passes**

Run: `npx vitest run tests/unit/updater-handlers.test.ts`
Expected: the first two describes PASS immediately (they use existing pieces); the "reports ready" case FAILS if `FakeUpdaterBackend.download()` emits `downloaded` before the service has entered `downloading`. If so, that is a real ordering bug — fix `service.check()` to `patch({status:'downloading'})` **before** awaiting `download()` (the implementation in Task 4 already does this) and re-run.

- [ ] **Step 3: Add the IPC handlers**

At the top of `src/main/ipc/handlers.ts`, add to the existing imports:

```ts
import { UpdatesSetEnabledSchema } from '../../shared/ipc.js'
import { UpdaterService } from '../updater/service.js'
import { selectBackend } from '../updater/backend.js'
import { ElectronUpdaterBackend } from '../updater/electron-backend.js'
import { canAutoInstall } from '../updater/policy.js'
import { shell } from 'electron'
```

This file is the right home for the `electron-updater` import: it is main-only and no unit test imports it, so the dependency never reaches the test runner. `backend.ts` stays clean and testable, and the import is static so the bundler resolves it normally.

(If `shell` or `app` are already imported from `electron` in this file, extend that import instead of adding a second one.)

Then append to `src/main/ipc/handlers.ts`:

```ts
let updater: UpdaterService | undefined

export function getUpdater(): UpdaterService | undefined {
  return updater
}

/**
 * Wires the updater to IPC. The renderer can read state, request a check,
 * toggle the preference, and install — but it cannot influence WHERE the
 * updater looks; owner/repo live in src/main/updater/policy.ts.
 */
export async function registerUpdateHandlers(
  getWindow: () => BrowserWindow | undefined,
): Promise<void> {
  const settings = getSettingsStore()
  const stored = (await settings.get())['updatesEnabled']
  const enabled = typeof stored === 'boolean' ? stored : true
  const fake = process.env['MODELITH_FAKE_UPDATER'] === '1'

  updater = new UpdaterService({
    backend: selectBackend({
      platform: process.platform,
      isPackaged: app.isPackaged,
      fake,
      // Injected here, not imported inside backend.ts, so electron-updater
      // never reaches the unit-test runner.
      electronBackendFactory: () => new ElectronUpdaterBackend(),
    }),
    currentVersion: app.getVersion(),
    // The fake backend drives the e2e suite, which runs unpackaged; force the
    // capability on so the full download → ready path is exercised.
    canAutoInstall: fake || canAutoInstall(process.platform, app.isPackaged),
    enabled,
    emit: (state) => {
      const window = getWindow()
      if (window && !window.isDestroyed()) {
        window.webContents.send(CHANNELS.updatesChanged, state)
      }
    },
    persistEnabled: async (value) => { await settings.set({ updatesEnabled: value }) },
  })

  ipcMain.handle(CHANNELS.updatesGet, () => updater?.getState())
  ipcMain.handle(CHANNELS.updatesCheck, () => updater?.check(true))
  ipcMain.handle(CHANNELS.updatesInstall, () => {
    const state = updater?.getState()
    // macOS (and any non-auto-install platform) opens the release page instead.
    // The URL was built by policy.releaseUrlFor from a hardcoded repo constant,
    // never taken from an API response.
    if (state && !state.canAutoInstall) {
      if (state.releaseUrl) void shell.openExternal(state.releaseUrl)
      return
    }
    updater?.install()
  })
  ipcMain.handle(CHANNELS.updatesSetEnabled, withZodMapping(async (_e, raw: unknown) => {
    await updater?.setEnabled(UpdatesSetEnabledSchema.parse(raw).enabled)
  }))

  updater.start()
}
```

`getSettingsStore()` already exists in this file (`src/main/ipc/handlers.ts:68`) and lazily constructs the shared `AppSettingsStore` — reuse it, do not add another accessor.

- [ ] **Step 4: Wire it into app startup**

In `src/main/index.ts`, change the handler import to include the new function:

```ts
import { registerHandlers, registerSecretHandlers, registerChatHandlers, registerWorkspaceHandlers, registerUpdateHandlers, getMcpManager } from './ipc/handlers.js'
```

Add inside `app.whenReady().then(...)`, after `registerWindowHandlers(...)`:

```ts
  // Update checks run in the background; a failure is surfaced as state, never
  // as a startup hang (same posture as the MCP init above).
  void registerUpdateHandlers(() => mainWindow)
```

And add a shutdown hook near the existing `window-all-closed` handler so the interval never outlives the app:

```ts
app.on('before-quit', () => {
  getUpdater()?.stop()
})
```

Add `getUpdater` to the same import list from `./ipc/handlers.js`.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npx vitest run tests/unit/updater-handlers.test.ts`
Expected: clean typecheck, tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/handlers.ts src/main/index.ts tests/unit/updater-handlers.test.ts
git commit -m "feat(updater): IPC handlers and app startup wiring"
```

---

### Task 7: Preload bridge

**Files:**
- Modify: `src/preload/index.ts`
- Test: `tests/e2e/preload-bridge.spec.ts` (add a case)

**Interfaces:**
- Consumes: `CHANNELS.updatesGet | updatesCheck | updatesInstall | updatesSetEnabled | updatesChanged`, `UpdateState`.
- Produces: `window.modelith.updates` with `getState()`, `check()`, `install()`, `setEnabled(enabled)`, `onStateChange(handler)`.

- [ ] **Step 1: Write the failing test**

Append to `tests/e2e/preload-bridge.spec.ts`:

```ts
test('window.modelith.updates exposes only the intended methods', async () => {
  const page = await app.firstWindow()
  const names = await page.evaluate(() => Object.keys(window.modelith.updates))
  expect(names.sort()).toEqual(['check', 'getState', 'install', 'onStateChange', 'setEnabled'])
})

test('the updates bridge offers no way to redirect the update feed', async () => {
  const page = await app.firstWindow()
  const state = await page.evaluate(() => window.modelith.updates.getState())
  // The renderer can read state but never supplies owner/repo/URL: a
  // renderer-controlled feed would let compromised UI point the updater at an
  // attacker's binary.
  expect(state).not.toHaveProperty('feedUrl')
  expect(typeof state.currentVersion).toBe('string')
  expect(typeof state.canAutoInstall).toBe('boolean')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && npx playwright test tests/e2e/preload-bridge.spec.ts`
Expected: FAIL — `window.modelith.updates` is undefined.

- [ ] **Step 3: Add the bridge**

In `src/preload/index.ts`, add `UpdateState` to the type import from `../shared/types.js`, then add this member to the `ModelithBridge` interface, after the `git` block:

```ts
  /** Software updates (auto-update spec). Read-only from the renderer's side:
   *  there is deliberately no way to supply a feed URL, owner, or repo. */
  updates: {
    getState(): Promise<UpdateState>
    check(): Promise<void>
    install(): Promise<void>
    setEnabled(enabled: boolean): Promise<void>
    onStateChange(handler: (state: UpdateState) => void): () => void
  }
```

And this to the `bridge` object, after the `git` block:

```ts
  updates: {
    getState: () => ipcRenderer.invoke(CHANNELS.updatesGet),
    check: () => ipcRenderer.invoke(CHANNELS.updatesCheck),
    install: () => ipcRenderer.invoke(CHANNELS.updatesInstall),
    setEnabled: (enabled) => ipcRenderer.invoke(CHANNELS.updatesSetEnabled, { enabled }),
    onStateChange: (handler) => {
      const listener = (_e: unknown, state: UpdateState) => handler(state)
      ipcRenderer.on(CHANNELS.updatesChanged, listener)
      return () => { ipcRenderer.off(CHANNELS.updatesChanged, listener) }
    },
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && npx playwright test tests/e2e/preload-bridge.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/preload/index.ts tests/e2e/preload-bridge.spec.ts
git commit -m "feat(updater): expose the updates namespace on the preload bridge"
```

---

### Task 8: Renderer store slice and the update chip

**Files:**
- Create: `src/renderer/app/UpdateChip.tsx`
- Modify: `src/renderer/state/store.ts`
- Modify: `src/renderer/sessions/Sidebar.tsx`
- Modify: `src/renderer/app/App.tsx` (call `loadUpdates()` at mount)
- Test: `tests/unit/update-chip.test.ts`

**Interfaces:**
- Consumes: `window.modelith.updates`, `UpdateState`.
- Produces: store fields `update: UpdateState | null` and actions `loadUpdates(): Promise<void>`, `setUpdateState(state: UpdateState): void`, `dismissUpdateChip(): void`, plus store field `updateChipDismissed: boolean`; component `UpdateChip`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/update-chip.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import React from 'react'
import { useAppStore } from '../../src/renderer/state/store.js'
import { UpdateChip } from '../../src/renderer/app/UpdateChip.js'
import type { UpdateState } from '../../src/shared/types.js'

const BASE: UpdateState = {
  status: 'idle',
  canAutoInstall: true,
  currentVersion: '0.2.0',
  enabled: true,
  manualCheck: false,
}

function render(container: HTMLDivElement): void {
  act(() => { createRoot(container).render(React.createElement(UpdateChip)) })
}

function setUpdate(patch: Partial<UpdateState>): void {
  useAppStore.setState({ update: { ...BASE, ...patch }, updateChipDismissed: false })
}

describe('UpdateChip', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    ;(window as unknown as { modelith: unknown }).modelith = {
      updates: {
        install: vi.fn().mockResolvedValue(undefined),
        check: vi.fn().mockResolvedValue(undefined),
        setEnabled: vi.fn().mockResolvedValue(undefined),
        getState: vi.fn().mockResolvedValue(BASE),
        onStateChange: vi.fn().mockReturnValue(() => {}),
      },
    }
    useAppStore.setState({ update: null, updateChipDismissed: false })
  })

  it('renders nothing while idle', () => {
    setUpdate({ status: 'idle' })
    render(container)
    expect(container.textContent).toBe('')
  })

  it('renders nothing while checking or downloading, so it never flickers', () => {
    setUpdate({ status: 'checking' })
    render(container)
    expect(container.textContent).toBe('')
  })

  it('prompts to restart once the download is ready', () => {
    setUpdate({ status: 'ready', latestVersion: '0.3.0' })
    render(container)
    expect(container.textContent).toMatch(/restart/i)
  })

  it('calls install when the ready chip is clicked', () => {
    setUpdate({ status: 'ready', latestVersion: '0.3.0' })
    render(container)
    const button = container.querySelector('[data-testid="update-chip-action"]') as HTMLButtonElement
    act(() => { button.click() })
    expect(window.modelith.updates.install).toHaveBeenCalled()
  })

  it('offers a download link instead of restart when the platform cannot auto-install', () => {
    setUpdate({ status: 'available', canAutoInstall: false, latestVersion: '0.3.0' })
    render(container)
    expect(container.textContent).toMatch(/download/i)
    expect(container.textContent).toMatch(/0\.3\.0/)
  })

  it('stays hidden on a background failure, so a failed check never nags', () => {
    setUpdate({ status: 'error', manualCheck: false, message: 'The update check failed.' })
    render(container)
    expect(container.textContent).toBe('')
  })

  it('shows a failure the user explicitly asked for', () => {
    setUpdate({ status: 'error', manualCheck: true, message: 'The update check failed.' })
    render(container)
    expect(container.textContent).toMatch(/failed/i)
  })

  it('hides once dismissed', () => {
    setUpdate({ status: 'ready', latestVersion: '0.3.0' })
    useAppStore.setState({ updateChipDismissed: true })
    render(container)
    expect(container.textContent).toBe('')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/update-chip.test.ts`
Expected: FAIL — cannot resolve `UpdateChip.js`.

- [ ] **Step 3: Add the store slice**

In `src/renderer/state/store.ts`, add `UpdateState` to the type imports from `@shared/types`, then add these fields to the state interface (near the other UI flags, after `platform`):

```ts
  /** Software-update state, mirrored from main (auto-update spec). */
  update: UpdateState | null
  /** The user closed the chip this session; Settings still shows the state. */
  updateChipDismissed: boolean
```

Add to the initial state object:

```ts
  update: null,
  updateChipDismissed: false,
```

Add these actions alongside `loadPlatform`:

```ts
  setUpdateState(state) { set({ update: state }) },
  dismissUpdateChip() { set({ updateChipDismissed: true }) },

  async loadUpdates() {
    try {
      const state = await window.modelith.updates.getState()
      set({ update: state })
    } catch (err) {
      set({ error: toProviderError(err) })
    }
  },
```

Declare them in the actions portion of the store's type:

```ts
  setUpdateState(state: UpdateState): void
  dismissUpdateChip(): void
  loadUpdates(): Promise<void>
```

- [ ] **Step 4: Create the chip**

Create `src/renderer/app/UpdateChip.tsx`:

```tsx
import { useAppStore } from '../state/store.js'

/**
 * The quiet update indicator, rendered in the sidebar footer.
 *
 * Deliberately silent for most of the lifecycle: `checking` and `downloading`
 * render nothing, because an app people leave open mid-conversation should not
 * flicker status at them. A background failure is silent too — only a failure
 * the user asked for (via "Check now") is shown.
 */
export function UpdateChip(): React.JSX.Element | null {
  const update = useAppStore((s) => s.update)
  const dismissed = useAppStore((s) => s.updateChipDismissed)
  const dismiss = useAppStore((s) => s.dismissUpdateChip)

  if (!update || dismissed) return null

  const { status, canAutoInstall, latestVersion, manualCheck, message } = update

  const visible =
    status === 'ready' ||
    (status === 'available' && !canAutoInstall) ||
    (status === 'error' && manualCheck)
  if (!visible) return null

  const label =
    status === 'ready' ? 'Update ready'
      : status === 'available' ? `v${latestVersion ?? ''} available`
        : (message ?? 'Update check failed')

  const actionLabel = status === 'ready' ? 'Restart' : status === 'available' ? 'Download' : null

  return (
    <div className="update-chip" data-testid="update-chip">
      <span className="update-chip-label">{label}</span>
      {actionLabel ? (
        <button
          className="update-chip-action"
          data-testid="update-chip-action"
          onClick={() => void window.modelith.updates.install()}
        >
          {actionLabel}
        </button>
      ) : null}
      <button
        className="update-chip-dismiss"
        data-testid="update-chip-dismiss"
        title="Dismiss"
        aria-label="Dismiss"
        onClick={dismiss}
      >
        ×
      </button>
    </div>
  )
}
```

> `install()` is correct for both actions: main routes a non-auto-install platform to `shell.openExternal(releaseUrl)` (Task 6), so the renderer never handles a URL.

- [ ] **Step 5: Render it and hydrate the state**

In `src/renderer/sessions/Sidebar.tsx`, import the chip:

```ts
import { UpdateChip } from '../app/UpdateChip.js'
```

and render it immediately **above** the existing `<div className="sidebar-foot">`:

```tsx
      <UpdateChip />
```

In `src/renderer/app/App.tsx`, add these two selectors alongside the existing ones (near `const loadPlatform = ...` on line 28):

```ts
  const loadUpdates = useAppStore((s) => s.loadUpdates)
  const setUpdateState = useAppStore((s) => s.setUpdateState)
```

and these two effects alongside the existing single-line effects (after line 49, `useEffect(() => window.modelith.chat.onEvent(applyEvent), [applyEvent])`), matching that file's one-effect-per-concern style:

```ts
  useEffect(() => { void loadUpdates() }, [loadUpdates])
  useEffect(() => window.modelith.updates.onStateChange(setUpdateState), [setUpdateState])
```

- [ ] **Step 6: Add minimal styling**

Append to `src/renderer/app/theme.css` (the file that defines `.sidebar-foot`):

```css
.update-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin: 0 8px 6px;
  border-radius: 6px;
  font-size: 12px;
  background: var(--accent-soft, rgba(120, 140, 255, 0.12));
}
.update-chip-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.update-chip-action { cursor: pointer; font-weight: 600; background: none; border: none; color: inherit; }
.update-chip-dismiss { cursor: pointer; background: none; border: none; color: inherit; opacity: 0.6; }
```

> Match the surrounding stylesheet's variable names and conventions; if `--accent-soft` does not exist, reuse whatever token neighbouring components use.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/update-chip.test.ts && npm run typecheck`
Expected: PASS and a clean typecheck.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/app/UpdateChip.tsx src/renderer/state/store.ts src/renderer/sessions/Sidebar.tsx src/renderer/app/App.tsx tests/unit/update-chip.test.ts
git commit -m "feat(updater): update chip in the sidebar footer with store slice"
```

---

### Task 9: Settings "Updates" section

**Files:**
- Modify: `src/renderer/settings/SettingsDialog.tsx`
- Test: `tests/unit/updates-settings.test.ts`

**Interfaces:**
- Consumes: `window.modelith.updates`, store field `update`.
- Produces: no new exports — UI only. Test IDs: `updates-toggle`, `updates-check-now`, `updates-status`, `updates-version`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/updates-settings.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import React from 'react'
import { useAppStore } from '../../src/renderer/state/store.js'
import { SettingsDialog } from '../../src/renderer/settings/SettingsDialog.js'
import type { UpdateState } from '../../src/shared/types.js'

const BASE: UpdateState = {
  status: 'idle',
  canAutoInstall: true,
  currentVersion: '0.2.0',
  enabled: true,
  manualCheck: false,
}

function installBridge(): void {
  ;(window as unknown as { modelith: unknown }).modelith = {
    providers: { list: vi.fn().mockResolvedValue([]) },
    keys: { has: vi.fn().mockResolvedValue(false), set: vi.fn(), delete: vi.fn() },
    updates: {
      getState: vi.fn().mockResolvedValue(BASE),
      check: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue(undefined),
      setEnabled: vi.fn().mockResolvedValue(undefined),
      onStateChange: vi.fn().mockReturnValue(() => {}),
    },
  }
}

describe('Settings — Updates section', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    installBridge()
    useAppStore.setState({ settingsOpen: true, update: BASE, error: null })
  })

  it('shows the current version', async () => {
    await act(async () => { createRoot(container).render(React.createElement(SettingsDialog)) })
    expect(container.querySelector('[data-testid="updates-version"]')?.textContent).toMatch(/0\.2\.0/)
  })

  it('reflects the enabled state in the toggle', async () => {
    await act(async () => { createRoot(container).render(React.createElement(SettingsDialog)) })
    const toggle = container.querySelector('[data-testid="updates-toggle"]') as HTMLInputElement
    expect(toggle.checked).toBe(true)
  })

  it('persists the toggle through the bridge', async () => {
    await act(async () => { createRoot(container).render(React.createElement(SettingsDialog)) })
    const toggle = container.querySelector('[data-testid="updates-toggle"]') as HTMLInputElement
    await act(async () => { toggle.click() })
    expect(window.modelith.updates.setEnabled).toHaveBeenCalledWith(false)
  })

  it('runs a manual check', async () => {
    await act(async () => { createRoot(container).render(React.createElement(SettingsDialog)) })
    const button = container.querySelector('[data-testid="updates-check-now"]') as HTMLButtonElement
    await act(async () => { button.click() })
    expect(window.modelith.updates.check).toHaveBeenCalled()
  })

  it('explains why macOS cannot install automatically', async () => {
    useAppStore.setState({ update: { ...BASE, canAutoInstall: false } })
    await act(async () => { createRoot(container).render(React.createElement(SettingsDialog)) })
    expect(container.querySelector('[data-testid="updates-status"]')?.textContent)
      .toMatch(/manual|download|cannot/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/updates-settings.test.ts`
Expected: FAIL — no `updates-version` element.

- [ ] **Step 3: Add the section**

In `src/renderer/settings/SettingsDialog.tsx`, add near the other store reads:

```ts
  const update = useAppStore((s) => s.update)
```

and render this as a new section, following the file's existing section markup (match the surrounding class names rather than inventing new ones):

```tsx
      <section className="settings-section">
        <h3>Updates</h3>
        <p className="settings-hint" data-testid="updates-version">
          Modelith {update?.currentVersion ?? ''}
        </p>
        <label className="settings-row">
          <input
            type="checkbox"
            data-testid="updates-toggle"
            checked={update?.enabled ?? true}
            onChange={(e) => void window.modelith.updates.setEnabled(e.target.checked)}
          />
          <span>Automatically check for updates</span>
        </label>
        <p className="settings-hint" data-testid="updates-status">
          {update?.status === 'error' && update.message
            ? update.message
            : update?.status === 'ready'
              ? `Version ${update.latestVersion ?? ''} is ready — restart to install.`
              : update?.status === 'available'
                ? `Version ${update.latestVersion ?? ''} is available.`
                : update?.status === 'downloading'
                  ? `Downloading… ${update.percent ?? 0}%`
                  : update?.status === 'checking'
                    ? 'Checking…'
                    : 'Up to date.'}
        </p>
        {update && !update.canAutoInstall ? (
          <p className="settings-hint">
            This build cannot install updates automatically, so new versions must be
            downloaded manually from the release page.
          </p>
        ) : null}
        <button
          className="settings-button"
          data-testid="updates-check-now"
          onClick={() => void window.modelith.updates.check()}
        >
          Check now
        </button>
      </section>
```

> The macOS explanation is rendered as its own paragraph but the test asserts against `updates-status`; if the section is laid out differently, ensure the words "manual", "download", or "cannot" appear inside the `updates-status` element instead.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/updates-settings.test.ts && npm run typecheck`
Expected: PASS and a clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/settings/SettingsDialog.tsx tests/unit/updates-settings.test.ts
git commit -m "feat(updater): Updates section in Settings"
```

---

### Task 10: E2E coverage, release workflow, and docs

**Files:**
- Create: `tests/e2e/updates.spec.ts`
- Modify: `.github/workflows/release.yml`
- Modify: `AGENTS.md`, `README.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `launchApp` from `./launch.js`; the `MODELITH_FAKE_UPDATER=1` env flag added in Task 6.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing e2e spec**

Create `tests/e2e/updates.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { launchApp } from './launch.js'

let app: ElectronApplication

// MODELITH_FAKE_UPDATER swaps in a backend that reports version 99.0.0 and
// "downloads" instantly, mirroring the MODELITH_FAKE_PROVIDER pattern. Without
// it the app runs unpackaged and deliberately never checks at all.
test.beforeAll(async () => { app = await launchApp({ MODELITH_FAKE_UPDATER: '1' }) })
test.afterAll(async () => { await app.close() })

test('a manual check surfaces a ready update in the chip', async () => {
  const page = await app.firstWindow()
  await page.evaluate(() => window.modelith.updates.check())
  const chip = page.getByTestId('update-chip')
  await expect(chip).toBeVisible()
  await expect(chip).toContainText(/restart/i)
})

test('the chip can be dismissed', async () => {
  const page = await app.firstWindow()
  await page.evaluate(() => window.modelith.updates.check())
  await page.getByTestId('update-chip-dismiss').click()
  await expect(page.getByTestId('update-chip')).toHaveCount(0)
})

test('the Settings toggle persists the preference', async () => {
  const page = await app.firstWindow()
  await page.getByTestId('open-settings').click()
  const toggle = page.getByTestId('updates-toggle')
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  const enabled = await page.evaluate(async () => (await window.modelith.updates.getState()).enabled)
  expect(enabled).toBe(false)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:e2e -- tests/e2e/updates.spec.ts`
Expected: FAIL until the whole chain from Task 6 through Task 9 is in place. If it fails because the settings dialog is already open or the chip renders behind another element, adjust the selectors — do not weaken the assertions.

- [ ] **Step 3: Publish the update metadata from CI**

In `.github/workflows/release.yml`, extend the `Upload installers as artifacts` path list:

```yaml
          path: |
            release/*.exe
            release/*.zip
            release/*.dmg
            release/*.AppImage
            release/latest*.yml
```

And update the step comment above it:

```yaml
      # latest*.yml is the update metadata electron-updater reads (it carries the
      # SHA512 of each installer). All three runners emit one — latest.yml,
      # latest-linux.yml, latest-mac.yml (verified on the v0.3.0 release).
      # Without these files on the release, every in-app update check fails, so
      # they ship alongside the installers.
      #
      # Only Windows and Linux are VERIFIED below. Modelith never reads
      # latest-mac.yml: macOS goes through CheckOnlyBackend, which queries the
      # GitHub API directly. It would be unusable anyway — it points at the dmg,
      # and Squirrel.Mac updates from a zip. Requiring a file we do not consume
      # would only add a way for the release to fail for no reason.
```

- [ ] **Step 4: Record the load-bearing flag in AGENTS.md**

In `AGENTS.md`, replace the existing electron-builder gotcha bullet with:

```markdown
- **electron-builder auto-publishes on a git tag.** `electron-builder.yml` now
  configures a `publish` provider (required so it emits the `latest*.yml` update
  metadata electron-updater reads). That makes `--publish never` in the `dist`
  script **load-bearing**: without it, electron-builder implicitly publishes on a
  tag and installers land in a separate draft release instead of the published
  one — the bug that shipped v0.2.0 with no installers. The GitHub release is
  created by the workflow's release job. Never remove `--publish never`.
```

- [ ] **Step 5: Document the network call**

In `README.md`, add to whichever section covers privacy / data handling:

```markdown
### Update checks

Modelith checks GitHub for a new release on launch and every six hours. It is an
anonymous `GET` to the public GitHub API — no identifiers, no usage data, nothing
about your conversations. Turn it off in **Settings → Updates**.

On Windows and Linux a new version downloads in the background and a chip offers
to restart and install. macOS builds are unsigned, and macOS refuses to
auto-install unsigned updates, so there the chip links to the release page for a
manual download.
```

- [ ] **Step 6: Update the changelog**

In `CHANGELOG.md`, add under `## [Unreleased]` (create the section if absent):

```markdown
### Added
- In-app software updates: Modelith checks GitHub for new releases, downloads
  them in the background on Windows and Linux, and offers to restart and install.
  macOS links to the release page because unsigned builds cannot auto-install.
  Toggle in Settings → Updates.
```

- [ ] **Step 7: Run the full suite**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: typecheck clean, all unit tests pass, all e2e pass. Report the real counts — do not claim green without seeing it.

- [ ] **Step 8: Commit**

```bash
git add tests/e2e/updates.spec.ts .github/workflows/release.yml AGENTS.md README.md CHANGELOG.md
git commit -m "test(updater): e2e coverage; publish update metadata and document the feature"
```

---

## Post-implementation

The spec's manual verification checklist cannot be automated and must be run against the first real tagged release:

1. Tag a release; confirm `latest.yml` and `latest-linux.yml` are attached alongside the installers.
2. Install the previous version on Windows, launch, wait for the chip, click Restart, confirm the new version runs.
3. Repeat on Linux with the AppImage.
4. On macOS, confirm the chip appears and opens the release page.
5. Confirm the Settings toggle suppresses checks entirely when off.
