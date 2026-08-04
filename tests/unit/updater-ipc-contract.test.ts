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
