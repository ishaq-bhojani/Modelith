import { describe, it, expect } from 'vitest'
import {
  selectBackend,
  CheckOnlyBackend,
  NullBackend,
  FakeUpdaterBackend,
  type UpdaterBackend,
} from '../../src/main/updater/backend.js'

// There is deliberately no test constructing the real ElectronUpdaterBackend
// here: that requires a real Electron runtime. Instead, the win32/linux
// branch is exercised through the `electronBackendFactory` seam — main (see
// src/main/ipc/handlers.ts) is the only caller that ever passes a factory
// producing a real ElectronUpdaterBackend, and that wiring is covered by the
// manual release checklist, not a unit test.
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

  it('uses the supplied factory on packaged win32/linux', () => {
    const sentinel: UpdaterBackend = new FakeUpdaterBackend()
    const electronBackendFactory = (): UpdaterBackend => sentinel

    expect(selectBackend({ platform: 'win32', isPackaged: true, electronBackendFactory })).toBe(sentinel)
    expect(selectBackend({ platform: 'linux', isPackaged: true, electronBackendFactory })).toBe(sentinel)
  })

  it('falls back to the null backend on packaged win32/linux when no factory is supplied', () => {
    // This is the caller-bug path: main is supposed to always pass
    // electronBackendFactory here. See the comment in backend.ts for why the
    // fallback is NullBackend (updates never run) rather than a thrown error.
    expect(selectBackend({ platform: 'win32', isPackaged: true })).toBeInstanceOf(NullBackend)
    expect(selectBackend({ platform: 'linux', isPackaged: true })).toBeInstanceOf(NullBackend)
  })
})
