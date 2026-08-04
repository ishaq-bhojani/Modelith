import type { UpdateState } from '../../shared/types.js'

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

/**
 * The `updates:install` routing decision, as a pure function of state. Kept
 * here — and kept pure — so the security property this task is really about
 * (shell.openExternal only ever receives a URL WE built, never something
 * lifted from an API response) is checkable without a live Electron process.
 * src/main/ipc/handlers.ts's `updates:install` handler is a thin shell that
 * just calls this and acts on the result.
 */
export type InstallAction =
  | { type: 'install' }
  | { type: 'open-release'; url: string }
  | { type: 'noop' }

export function resolveInstallAction(state: UpdateState): InstallAction {
  if (state.canAutoInstall) {
    // Mirrors UpdaterService.install()'s own guard: installing is only ever
    // meaningful once a download has actually finished.
    return state.status === 'ready' ? { type: 'install' } : { type: 'noop' }
  }
  // macOS (and any other non-auto-install platform): open the release page
  // instead — but never call shell.openExternal with an undefined URL just
  // because a check hasn't completed yet.
  return state.releaseUrl ? { type: 'open-release', url: state.releaseUrl } : { type: 'noop' }
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
