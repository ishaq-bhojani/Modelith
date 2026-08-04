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
