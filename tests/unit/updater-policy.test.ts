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
