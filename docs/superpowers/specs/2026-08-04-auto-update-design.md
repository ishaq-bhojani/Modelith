# Software updates — design

Date: 2026-08-04
Status: approved (design), pending implementation plan

## Problem

Modelith ships installers through GitHub Releases, but a user who installs
v0.2.0 has no way to learn that v0.3.0 exists. There is no update check, no
notification, and no install path short of manually revisiting the releases page.
For a young, fast-moving app that is a real distribution problem: fixes ship and
nobody receives them.

This design adds an in-app update check that downloads a new release in the
background and prompts the user to restart to install it.

## Goals

1. The app **notices** a newer GitHub release without the user doing anything.
2. On platforms where it is possible, the update **downloads automatically** and
   the user is told to restart to install.
3. The check is **honest about its limits** — where auto-install is impossible,
   the user is told a new version exists and pointed at the download.
4. The user can **turn it off**, and can check on demand.

## Non-goals

- Code signing / notarization. Tracked separately; this design works around its
  absence rather than blocking on it.
- Delta/differential updates, staged rollouts, or update channels
  (beta/nightly). Stable releases only.
- Silent install without the user's knowledge.
- In-app release notes rendering. The chip links to the GitHub release page.

---

## Constraints that shaped the design

- **Builds are unsigned.** `.github/workflows/release.yml` sets
  `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`. macOS direct distribution requires a
  Developer ID Application certificate **plus** notarization for Gatekeeper, and
  Squirrel.Mac refuses to apply an unsigned update. **macOS therefore cannot
  auto-install.** Windows (NSIS) and Linux (AppImage) update fine unsigned.
- **The renderer has no network egress.** CSP is `connect-src 'self'`
  (`src/main/security/csp.ts`), and every privileged operation lives in main.
  The update check is main-process work by construction.
- **Existing packaging targets** are win `nsis` + `zip`, mac `dmg`, linux
  `AppImage` (`electron-builder.yml`). None change.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Platform scope | Win + Linux auto-install; macOS detect-and-link | Signing makes mac auto-install impossible; detection still has value |
| Mechanism | `electron-updater` | Gets SHA512 verification, resumable download, NSIS staging and the AppImage in-place swap; hand-rolling integrity checks for a binary we then execute is the wrong thing to own |
| Trigger | Auto, on by default, with a toggle | ~4 anonymous requests/day; opt-out respects the no-telemetry promise |
| Cadence | ~10s after ready, then every 6h | Startup stays fast; long-running windows still learn about releases |
| UI | Quiet chip in `sidebar-foot` + Settings section | Never interrupts an in-flight stream or agent turn |

### Rejected: `update-electron-app` / update.electronjs.org

A free hosted feed for public repos, but it drives **Squirrel.Windows** (we ship
NSIS) and has **no Linux support**. Adopting it would mean changing the Windows
installer format and dropping Linux updates entirely.

### Rejected: hand-rolled GitHub Releases updater

Zero-dependency and fully unit-testable, but we would own publishing and
verifying our own checksums, plus the AppImage in-place replacement (the running
AppImage is mounted; the target path comes from `$APPIMAGE`). Without a verified
checksum the app would execute an unverified downloaded binary with the user's
privileges. Not worth the dependency saved.

---

## Architecture

New `src/main/updater/`, three files, one responsibility each:

| File | Responsibility | Depends on |
|---|---|---|
| `policy.ts` | **Pure logic.** Is a check due? Is this platform auto-installable? Version compare and formatting. No Electron import. | nothing |
| `backend.ts` | The `UpdaterBackend` interface, the non-Electron implementations, and `selectBackend()`. Imports no packaging dependency. | policy |
| `electron-backend.ts` | The **only** file importing `electron-updater`. Adapter exposing `check()`, `download()`, `quitAndInstall()`, event subscription. Kept out of `backend.ts`'s import graph — `selectBackend()` receives it via an injected `electronBackendFactory` that `main` (which can statically `import` `electron-backend.js`) supplies, rather than `backend.ts` importing it itself, lazily or otherwise. That keeps unit tests that import `backend.ts` from pulling in a module that needs a real Electron runtime. (An earlier design loaded it lazily via `createRequire`; Rollup cannot follow that at bundle time, so it produced `MODULE_NOT_FOUND` in every packaged build and was replaced with this factory-injection approach.) | electron-updater |
| `service.ts` | Owns lifecycle, timer, and current state; pushes state to the renderer. Receives the backend as a **constructor argument**. | policy, backend interface |

The injected backend is the testability seam: `service.ts` is unit-tested against
a fake, `policy.ts` is pure, and `backend.ts` stays too thin to hold a bug.

### Two backends, one interface

```ts
interface UpdaterBackend {
  check(): Promise<{ version: string } | null>
  download(): Promise<void>          // rejects on a check-only backend
  quitAndInstall(): void
  on(event: UpdaterBackendEvent, cb: (payload: unknown) => void): void
}
```

- `ElectronUpdaterBackend` — Windows and Linux. Wraps `autoUpdater`.
- `CheckOnlyBackend` — macOS. A single GET to the GitHub Releases API; reports
  the latest version and nothing else. Never downloads, so it carries no
  integrity burden. Its `download()` rejects, and `service.ts` never calls it
  because `canAutoInstall` is false — the rejection is a guard, not a code path.
- `NullBackend` — unpackaged builds. Reports no update, so the service runs
  harmlessly and stays `idle`.
- `FakeUpdaterBackend` — driven by `MODELITH_FAKE_UPDATER=1` for e2e, mirroring
  the existing `MODELITH_FAKE_PROVIDER` pattern.

`service.ts` contains no platform branching; `selectBackend()` chooses once at
construction.

### Trust boundary

- All network traffic is in main. The renderer CSP is unchanged.
- **The renderer never supplies owner, repo, or feed URL.** These are constants
  in main, for the same reason `src/shared/ipc.ts` refuses a renderer-supplied
  `baseUrl`: a renderer-controlled feed would let compromised UI point the
  updater at an attacker's binary.
- No API key or secret is involved; the updater touches neither the keystore nor
  the workspace root.

---

## State machine

One `UpdateState` object, owned by main and mirrored into the Zustand store:

```ts
type UpdateStatus =
  | 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'

interface UpdateState {
  status: UpdateStatus
  canAutoInstall: boolean   // false on macOS and whenever unpackaged
  currentVersion: string
  latestVersion?: string
  percent?: number          // download progress, 0–100
  releaseUrl?: string       // constructed by main, never taken from a response
  message?: string          // our own text; never echoes a response body
  enabled: boolean
  lastCheckedAt?: number
  manualCheck: boolean      // true when the current cycle began with "Check now"
}
```

`manualCheck` exists so the chip can stay silent on a background failure while
still reporting one the user explicitly asked for. It is set when
`updates:check` arrives from the renderer and cleared when the cycle ends.

Transitions:

- **Windows / Linux:** `idle → checking → available → downloading → ready`.
  Download starts automatically on `available`. Readiness is derived from
  **either** the backend's `downloaded` event **or** `download()` resolving,
  whichever lands first. Relying on the event alone would let a backend that
  resolves silently park the state in `downloading` forever, after which the
  re-entrancy guard swallows every future check — scheduled and manual — with
  no error and no recovery.
- **macOS:** `idle → checking → available`, and stops — `canAutoInstall` is
  false. The chip's action opens the release page with `shell.openExternal`.
- **No update:** `checking → idle`, with `lastCheckedAt` updated.
- **Any failure:** `→ error`, then back to `idle` on the next successful check.

### Unpackaged builds

`electron-updater` throws when the app is not packaged. When
`app.isPackaged === false` — development and **every e2e run** —
`selectBackend()` returns `NullBackend`, so nothing reaches `electron-updater`
and the state stays `idle` with `canAutoInstall: false`.

### Timing and install

- First check ~10s after `app.whenReady()`, so startup is never blocked on the
  network.
- Then every 6h; the interval is cleared on quit.
- `autoInstallOnAppQuit = true`. A user who ignores the chip still gets the
  update applied on their next normal quit, with no second prompt.
- "Restart" calls `quitAndInstall()`.

---

## IPC and renderer

**Channels** (`src/shared/ipc.ts`), following the existing `settings:get` naming:

| Key | Channel | Direction |
|---|---|---|
| `updatesGet` | `updates:get` | renderer → main |
| `updatesCheck` | `updates:check` | renderer → main |
| `updatesInstall` | `updates:install` | renderer → main |
| `updatesSetEnabled` | `updates:set-enabled` | renderer → main |
| `updatesChanged` | `updates:changed` | main → renderer |

`UpdateStateSchema` and `UpdatesSetEnabledSchema` join the existing zod
contract. Adding these means touching
`shared/ipc.ts → main/ipc/handlers.ts → preload → renderer store` together, per
`AGENTS.md`.

**Preload bridge:**

```ts
window.modelith.updates = {
  getState(): Promise<UpdateState>
  check(): Promise<void>
  install(): Promise<void>
  setEnabled(enabled: boolean): Promise<void>
  onStateChange(cb: (s: UpdateState) => void): () => void
}
```

**Renderer:**

- `src/renderer/app/UpdateChip.tsx` — rendered in `sidebar-foot`. Returns `null`
  unless status is `available`, `ready`, or (`error` **and** `manualCheck`).
  Copy: "Update ready · Restart" (win/linux), "v0.3.0 available · Download"
  (macOS). Dismissible for the session; Settings always retains the state.
- `SettingsDialog.tsx` gains an **Updates** section: current version, an
  "Automatically check for updates" toggle, a "Check now" button, and last-check
  status.
- Store slice `update`, hydrated via `getState()` and kept live by
  `onStateChange`.

**Persistence:** `updatesEnabled: boolean` (default `true`) in the existing
`AppSettingsStore` (`userData/settings.json`). No new store.

---

## Release plumbing

1. **`electron-builder.yml`** gains:

   ```yaml
   publish:
     provider: github
     owner: ishaq-bhojani
     repo: Modelith
   ```

   This is what makes electron-builder emit `latest.yml` / `latest-linux.yml`.

   > ⚠️ **This is the config that caused the v0.2.0 release bug.** A configured
   > `publish` provider is what let electron-builder implicitly publish on a git
   > tag, putting installers into a separate draft release. `--publish never` in
   > the `dist` script (commit `b376c4d`) is what suppresses it. That flag is now
   > **load-bearing** and must never be removed. The `AGENTS.md` gotcha will be
   > updated to say why.

2. **`.github/workflows/release.yml`** — the upload-artifact glob gains
   `release/latest*.yml`. Without those files on the release, the updater has
   nothing to read and every check fails. Windows emits `latest.yml` and Linux
   emits `latest-linux.yml`. macOS emits **no** metadata file — it ships
   `mac.target: dmg`, and electron-builder only writes update metadata for a
   `zip` target on macOS — which is expected, since macOS goes through
   `CheckOnlyBackend` and queries the GitHub API directly instead of reading a
   metadata file. A per-OS step verifies the expected file exists on
   Windows/Linux before upload (skipped on macOS), so a regression that
   silently drops the metadata fails the build instead of shipping quietly.

No change to installer targets, and installers stay unsigned.

---

## Error handling

Mirroring the `streamChat` golden rule: **the updater never throws across IPC.**
Every failure becomes `status: 'error'` with a message we authored.

| Failure | Behaviour |
|---|---|
| Offline / DNS failure | `error`, silent in the chip, visible in Settings. Retried at the next interval. |
| GitHub 404 (no release yet) | Treated as "no update", not an error. |
| Rate limit (60/hr unauthenticated) | `error` with a "try again later" message. Our ~4 requests/day is far under. |
| Corrupt/mismatched download | electron-updater rejects on SHA512 mismatch → `error`; nothing is installed. |
| `quitAndInstall` fails | `error`, app stays running, chip offers the release page as a fallback. |

A failed check must **never** nag: the chip stays hidden on `error` unless the
user explicitly pressed "Check now".

## Security

- **Integrity** is electron-updater's SHA512 verification against `latest.yml`.
  This is the central reason for choosing it over a hand-rolled updater.
- **`releaseUrl` is constructed by main** from the version tag against a
  hardcoded repo constant. A URL from an API response is never passed to
  `shell.openExternal`.
- **`message` is always our own string.** No response body is echoed into it, so
  attacker-controlled text cannot reach the DOM.
- **No identifiers are transmitted** — an anonymous GET to a public API, with no
  machine ID, user ID, or usage data. This is documented in the README so it does
  not contradict the no-telemetry promise.
- Installers remain unsigned; this design does not weaken any existing guarantee,
  but it also does not add authenticity beyond HTTPS + the SHA512 in the
  GitHub-hosted metadata.

## Testing

TDD per golden rule 6 — failing test first.

**Unit** (`tests/unit/updater/`):

- `policy`: check-due math against `lastCheckedAt`; the `canAutoInstall` matrix
  across win/linux/mac × packaged/unpackaged; version compare for newer, equal,
  older, and malformed input.
- `service`: the full state machine against a fake backend — the happy path
  through `ready`; the error path sets `error` and never throws; `enabled: false`
  performs no check; macOS stops at `available`; the interval is scheduled and
  cleared.
- URL construction and the `shell.openExternal` allow-check.

**E2E** (`tests/e2e/updates.spec.ts`), launched with `MODELITH_FAKE_UPDATER=1`
mirroring the existing `MODELITH_FAKE_PROVIDER` pattern: the chip appears and
reads "Restart", the Settings toggle takes effect and is readable back via
`getState()` within the same session, and "Check now" drives a visible state
change. A real cross-relaunch persistence test would need a shared
`MODELITH_USER_DATA` directory across launches — `launchApp` mints a fresh one
per launch, so that path is not exercised here. The persistence-survives-reload
behaviour IS covered, honestly, by `tests/unit/updater-handlers.test.ts`.

**Also touched:** `tests/e2e/preload-bridge.spec.ts` currently asserts only that
`keys` exposes no read path, so adding `updates` does not break it. Two cases are
added there deliberately: that `updates` exposes exactly the five intended
methods, and that nothing in its surface could redirect the update feed.

**Known limitation:** no automated test verifies a *real* download-and-install.
That can only be confirmed by hand against a genuine tagged release, and is
recorded as a manual release-checklist item rather than treated as covered.

## Manual verification checklist (first release after this lands)

1. Tag a release; confirm `latest.yml` and `latest-linux.yml` are attached
   alongside the installers.
2. Install the previous version on Windows, launch, wait for the chip, click
   Restart, confirm the new version runs.
3. Repeat on Linux with the AppImage.
4. On macOS, confirm the chip appears and opens the release page.
5. Confirm the Settings toggle suppresses checks entirely when off.
