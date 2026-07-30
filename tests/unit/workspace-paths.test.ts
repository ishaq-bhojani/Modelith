import { describe, it, expect } from 'vitest'
import { isInsideRoot, isIgnored } from '../../src/main/workspace/paths.js'

/**
 * Path confinement is the whole security story for workspace read: main must
 * never read a file outside the dialog-chosen root. These assertions are the
 * proof, run against the tricks an attacker (or a confused model) would try.
 * Inputs are already-resolved absolute paths using POSIX separators; the real
 * module resolves + realpaths before calling this, so here we test the pure
 * containment decision.
 */
describe('isInsideRoot', () => {
  const root = '/home/user/project'

  it('accepts the root itself and files within it', () => {
    expect(isInsideRoot(root, '/home/user/project')).toBe(true)
    expect(isInsideRoot(root, '/home/user/project/src/index.ts')).toBe(true)
    expect(isInsideRoot(root, '/home/user/project/a/b/c.txt')).toBe(true)
  })

  it('rejects paths that escape via ..', () => {
    expect(isInsideRoot(root, '/home/user/secret.txt')).toBe(false)
    expect(isInsideRoot(root, '/home/user')).toBe(false)
    expect(isInsideRoot(root, '/etc/passwd')).toBe(false)
  })

  it('rejects a sibling directory that merely shares the root as a prefix', () => {
    // The classic prefix bug: "/home/user/project-evil" starts with the root
    // string but is NOT inside it.
    expect(isInsideRoot(root, '/home/user/project-evil')).toBe(false)
    expect(isInsideRoot(root, '/home/user/project-evil/x.ts')).toBe(false)
  })

  it('is not fooled by a trailing slash on the root', () => {
    expect(isInsideRoot('/home/user/project/', '/home/user/project/x')).toBe(true)
    expect(isInsideRoot('/home/user/project/', '/home/user/projectx')).toBe(false)
  })
})

describe('isIgnored', () => {
  it('prunes the usual noise directories anywhere in the path', () => {
    expect(isIgnored('node_modules')).toBe(true)
    expect(isIgnored('.git')).toBe(true)
    expect(isIgnored('src/node_modules/foo')).toBe(true)
    expect(isIgnored('a/.git/config')).toBe(true)
    expect(isIgnored('dist')).toBe(true)
  })

  it('leaves ordinary source paths alone', () => {
    expect(isIgnored('src/index.ts')).toBe(false)
    expect(isIgnored('README.md')).toBe(false)
    expect(isIgnored('packages/app/main.ts')).toBe(false)
  })
})
